import { Anthropic } from "@anthropic-ai/sdk"
import { CodeAgentModelInfo, ModelInfo, openAiModelInfoSaneDefaults } from "@shared/api"
import OpenAI from "openai"
import { Logger } from "@/services/logging/Logger"
import { ApiHandler, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

interface CodeAgentHandlerOptions extends CommonApiHandlerOptions {
	codeagentBaseUrl?: string
	codeagentApiKey?: string
	codeagentModelId?: string
	codeagentModelInfo?: CodeAgentModelInfo
}

/**
 * Convert CodeAgentModelInfo to ModelInfo for internal use
 */
function convertCodeAgentModelInfoToModelInfo(codeAgentInfo: CodeAgentModelInfo): ModelInfo {
	return {
		maxTokens: codeAgentInfo.maxTokens ?? 100000, // Default max tokens for CodeAgent models
		contextWindow: codeAgentInfo.maxContextWindow ?? 200000, // Default context window
		supportsImages: codeAgentInfo.supportImage ?? false, // CodeAgent models typically don't support images
		supportsPromptCache: false, // Set based on your backend capabilities
		inputPrice: codeAgentInfo.inputTokensPer1m ?? 0, // Price per 1M tokens
		outputPrice: codeAgentInfo.outputTokensPer1m ?? 0, // Price per 1M tokens
		cacheWritesPrice: codeAgentInfo.cachedInputTokensPer1m ?? 0, // Price per 1M tokens
		cacheReadsPrice: 0, // Set if your backend provides this
		description: codeAgentInfo.description || codeAgentInfo.displayName || codeAgentInfo.modelId,
	}
}

export class CodeAgentHandler implements ApiHandler {
	private options: CodeAgentHandlerOptions
	private client: OpenAI | undefined

	constructor(options: CodeAgentHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.codeagentApiKey) {
				throw new Error("CodeAgent API key is required")
			}
			if (!this.options.codeagentBaseUrl) {
				throw new Error("CodeAgent Base URL is required")
			}
			try {
				// Normalize the base URL to format: (http|https)://domain
				let baseUrl = this.options.codeagentBaseUrl.trim()

				// Validate that URL starts with http:// or https://
				if (!baseUrl.match(/^https?:\/\//i)) {
					throw new Error("Base URL must start with http:// or https://")
				}

				// Remove all trailing slashes
				baseUrl = baseUrl.replace(/\/+$/, "")

				// Remove any path segments (keep only protocol and domain)
				const urlObj = new URL(baseUrl)
				baseUrl = `${urlObj.protocol}//${urlObj.host}`

				this.client = new OpenAI({
					baseURL: baseUrl + "/api/openai",
					apiKey: this.options.codeagentApiKey,
					defaultHeaders: {
						"HTTP-Referer": "https://cline.bot",
						"X-Title": "Cline-CodeAgent",
					},
				})
			} catch (error: any) {
				throw new Error(`Error creating CodeAgent client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const client = this.ensureClient()
		const modelId = this.options.codeagentModelId ?? ""
		const codeAgentModelInfo = this.options.codeagentModelInfo

		console.log("KAENOVA: codeagentModelInfo from options:", codeAgentModelInfo)
		console.log("KAENOVA: Full options:", this.options)

		// Convert CodeAgentModelInfo to ModelInfo for internal use
		const modelInfo = codeAgentModelInfo ? convertCodeAgentModelInfoToModelInfo(codeAgentModelInfo) : undefined

		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		// Use model info if available, otherwise use sane defaults (similar to OpenAI handler)
		const temperature = openAiModelInfoSaneDefaults.temperature
		const maxTokens = modelInfo?.maxTokens && modelInfo.maxTokens > 0 ? modelInfo.maxTokens : undefined

		Logger.log(`Creating CodeAgent chat completion with model: ${modelId}`)

		const stream = await client.chat.completions.create({
			model: modelId,
			messages: openAiMessages,
			temperature,
			max_tokens: maxTokens,
			stream: true,
			stream_options: { include_usage: true },
		})

		let lastUsage: OpenAI.CompletionUsage | undefined

		console.log("KAENOVA: Model Info:", modelInfo)

		for await (const chunk of stream) {
			console.log("KAENOVA: Received chunk:", chunk)
			const delta = chunk.choices[0]?.delta
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if (chunk.usage) {
				yield* this.yieldUsage(modelInfo!, chunk.usage)
			}
		}
	}

	private async *yieldUsage(info: ModelInfo, usage: OpenAI.Completions.CompletionUsage | undefined): ApiStream {
		if (!(info.inputPrice && info.outputPrice && info.cacheWritesPrice)) {
			return
		}

		const inputTokens = usage?.prompt_tokens || 0 // sum of cache hits and misses
		const outputTokens = usage?.completion_tokens || 0
		const cacheReadTokens = usage?.prompt_tokens_details?.cached_tokens || 0
		const cacheWriteTokens = 0
		const nonCachedInputTokens = Math.max(0, inputTokens - cacheReadTokens - cacheWriteTokens)

		const totalCost =
			(inputTokens - cacheReadTokens) * (info.inputPrice / 1000000) +
			outputTokens * (info.outputPrice / 1000000) +
			cacheWriteTokens * (info.cacheWritesPrice / 1000000)

		yield {
			type: "usage",
			inputTokens: nonCachedInputTokens,
			outputTokens: outputTokens,
			cacheWriteTokens: cacheWriteTokens,
			cacheReadTokens: cacheReadTokens,
			totalCost: totalCost,
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.codeagentModelId
		const codeAgentModelInfo = this.options.codeagentModelInfo

		if (modelId && codeAgentModelInfo) {
			// Convert CodeAgentModelInfo to ModelInfo
			const modelInfo = convertCodeAgentModelInfoToModelInfo(codeAgentModelInfo)
			return { id: modelId, info: modelInfo }
		}

		// Default model info - mimics OpenAI defaults
		// These will be replaced by actual model info fetched from the backend
		return {
			id: modelId || "gpt-4",
			info: {
				maxTokens: openAiModelInfoSaneDefaults.maxTokens,
				contextWindow: 128000,
				supportsImages: true,
				supportsPromptCache: false,
				inputPrice: 0,
				outputPrice: 0,
				description: "CodeAgent model",
			},
		}
	}
}
