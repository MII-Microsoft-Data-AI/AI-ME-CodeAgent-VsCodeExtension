import { Anthropic } from "@anthropic-ai/sdk"
import { ModelInfo, OpenAiCompatibleModelInfo, openAiModelInfoSaneDefaults } from "@shared/api"
import { calculateApiCostOpenAI } from "@utils/cost"
import OpenAI from "openai"
import { ApiHandler, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

interface CodeAgentHandlerOptions extends CommonApiHandlerOptions {
	codeagentBaseUrl?: string
	codeagentApiKey?: string
	codeagentModelId?: string
	codeagentModelInfo?: ModelInfo
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
				// Ensure the base URL is properly formatted for OpenAI SDK
				// The OpenAI SDK expects baseURL without /v1 suffix (it adds it automatically)
				let baseUrl = this.options.codeagentBaseUrl.trim()
				// Remove trailing slashes
				baseUrl = baseUrl.replace(/\/+$/, "")
				// Remove /v1 suffix if present (OpenAI SDK adds it)
				if (baseUrl.endsWith("/v1")) {
					baseUrl = baseUrl.slice(0, -3)
				}

				this.client = new OpenAI({
					baseURL: baseUrl,
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
		const modelInfo = this.options.codeagentModelInfo as OpenAiCompatibleModelInfo | undefined

		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		// Use model info if available, otherwise use sane defaults (similar to OpenAI handler)
		const temperature = modelInfo?.temperature ?? openAiModelInfoSaneDefaults.temperature
		const maxTokens = modelInfo?.maxTokens && modelInfo.maxTokens > 0 ? modelInfo.maxTokens : undefined

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
		const modelInfo = this.options.codeagentModelInfo
		if (modelId && modelInfo) {
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
