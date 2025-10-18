import { Anthropic } from "@anthropic-ai/sdk"
import { CodeAgentModelInfo, ModelInfo, openAiModelInfoSaneDefaults } from "@shared/api"
import { calculateApiCostOpenAI } from "@utils/cost"
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
		maxTokens: 4096, // Default max tokens for CodeAgent models
		contextWindow: 128000, // Default context window
		supportsImages: false, // CodeAgent models typically don't support images
		supportsPromptCache: false, // Set based on your backend capabilities
		inputPrice: codeAgentInfo.inputTokensPer1m, // Convert from per 1k to per 1M
		outputPrice: codeAgentInfo.outputTokensPer1m, // Convert from per 1k to per 1M
		cacheWritesPrice: codeAgentInfo.cachedInputTokensPer1m, // Convert from per 1k to per 1M
		cacheReadsPrice: 0, // Set if your backend provides this
		description: codeAgentInfo.displayName || codeAgentInfo.modelId,
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

		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if (chunk.usage) {
				lastUsage = chunk.usage
			}
		}

		if (lastUsage) {
			const inputTokens = lastUsage.prompt_tokens || 0
			const outputTokens = lastUsage.completion_tokens || 0
			// Support for prompt caching if the backend provides it
			const cacheWriteTokens = (lastUsage as any).prompt_tokens_details?.caching_tokens || undefined
			const cacheReadTokens = (lastUsage as any).prompt_tokens_details?.cached_tokens || undefined

			const model = this.getModel()
			const totalCost = calculateApiCostOpenAI(model.info, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens)

			yield {
				type: "usage",
				inputTokens: inputTokens,
				outputTokens: outputTokens,
				cacheWriteTokens: cacheWriteTokens,
				cacheReadTokens: cacheReadTokens,
				totalCost: totalCost,
			}
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
