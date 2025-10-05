import { ensureCacheDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import { EmptyRequest } from "@shared/proto/cline/common"
import { OpenRouterCompatibleModelInfo, OpenRouterModelInfo } from "@shared/proto/cline/models"
import { fileExistsAtPath } from "@utils/fs"
import axios from "axios"
import fs from "fs/promises"
import path from "path"
import { Controller } from ".."

/**
 * Reads cached CodeAgent models from disk
 */
async function readCodeAgentModels(): Promise<Record<string, OpenRouterModelInfo> | null> {
	try {
		const codeagentModelsFilePath = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.codeagentModels)
		if (await fileExistsAtPath(codeagentModelsFilePath)) {
			const data = await fs.readFile(codeagentModelsFilePath, "utf-8")
			return JSON.parse(data)
		}
	} catch (error) {
		console.error("Error reading cached CodeAgent models:", error)
	}
	return null
}

/**
 * Refreshes the CodeAgent models and returns the updated model list
 * @param controller The controller instance
 * @param request Empty request object
 * @returns Response containing the CodeAgent models
 */
export async function refreshCodeAgentModels(
	controller: Controller,
	_request: EmptyRequest,
): Promise<OpenRouterCompatibleModelInfo> {
	console.log("=== refreshCodeAgentModels called ===")
	const codeagentModelsFilePath = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.codeagentModels)

	// Get the CodeAgent API key and base URL from the controller's state
	const apiConfiguration = controller.stateManager.getApiConfiguration()
	const codeagentApiKey = apiConfiguration?.codeagentApiKey
	const codeagentBaseUrl = apiConfiguration?.codeagentBaseUrl

	const models: Record<string, Partial<OpenRouterModelInfo>> = {}

	try {
		if (!codeagentApiKey || !codeagentBaseUrl) {
			console.log("No CodeAgent API key or base URL found, using empty model list")
			// Return empty models - user needs to configure both API key and base URL
		} else {
			// Ensure the API key and base URL are properly formatted
			const cleanApiKey = codeagentApiKey.trim()
			const cleanBaseUrl = codeagentBaseUrl.trim().replace(/\/$/, "")

			if (!cleanApiKey || !cleanBaseUrl) {
				throw new Error("Invalid CodeAgent API key or base URL format")
			}

			console.log("Fetching CodeAgent models from:", cleanBaseUrl)

			// Construct the models endpoint URL
			const modelsUrl = cleanBaseUrl.endsWith("/v1") ? `${cleanBaseUrl}/models` : `${cleanBaseUrl}/v1/models`

			const response = await axios.get(modelsUrl, {
				headers: {
					Authorization: `Bearer ${cleanApiKey}`,
					"Content-Type": "application/json",
					"User-Agent": "Cline-VSCode-Extension",
				},
				timeout: 15000, // 15 second timeout
			})

			if (response.data?.data) {
				const rawModels = response.data.data

				for (const rawModel of rawModels) {
					// Basic validation - ensure the model has an id
					if (!rawModel.id) {
						continue
					}

					// Extract model information from the response
					// Adapt these fields based on your CodeAgent backend's actual response structure
					const modelInfo: Partial<OpenRouterModelInfo> = {
						maxTokens: rawModel.max_tokens || rawModel.max_completion_tokens || 8192,
						contextWindow: rawModel.context_window || rawModel.context_length || 128000,
						supportsImages: rawModel.supports_images || rawModel.vision || false,
						supportsPromptCache: rawModel.supports_prompt_cache || false,
						inputPrice: rawModel.input_price || rawModel.pricing?.input || 0,
						outputPrice: rawModel.output_price || rawModel.pricing?.output || 0,
						cacheWritesPrice: rawModel.cache_writes_price || 0,
						cacheReadsPrice: rawModel.cache_reads_price || 0,
						description: rawModel.description || `${rawModel.id} - CodeAgent model`,
					}

					models[rawModel.id] = modelInfo
				}

				await fs.writeFile(codeagentModelsFilePath, JSON.stringify(models))
				console.log("CodeAgent models fetched and saved:", Object.keys(models))
			} else {
				console.error("Invalid response from CodeAgent API")
			}
		}
	} catch (error) {
		console.error("Error fetching CodeAgent models:", error)

		// Provide more specific error messages
		let errorMessage = "Unknown error occurred"
		if (axios.isAxiosError(error)) {
			if (error.response?.status === 401) {
				errorMessage = "Invalid CodeAgent API key. Please check your API key in settings."
			} else if (error.response?.status === 403) {
				errorMessage = "Access forbidden. Please verify your CodeAgent API key has the correct permissions."
			} else if (error.response?.status === 404) {
				errorMessage = "CodeAgent API endpoint not found. Please verify your base URL is correct."
			} else if (error.response?.status === 429) {
				errorMessage = "Rate limit exceeded. Please try again later."
			} else if (error.code === "ECONNABORTED") {
				errorMessage = "Request timeout. Please check your internet connection and CodeAgent base URL."
			} else {
				errorMessage = `API request failed: ${error.response?.status || error.code || "Unknown error"}`
			}
		} else if (error instanceof Error) {
			errorMessage = error.message
		}

		console.error("CodeAgent API Error:", errorMessage)

		// If we failed to fetch models, try to read cached models first
		const cachedModels = await readCodeAgentModels()
		if (cachedModels && Object.keys(cachedModels).length > 0) {
			console.log("Using cached CodeAgent models")
			for (const [modelId, modelInfo] of Object.entries(cachedModels)) {
				models[modelId] = modelInfo
			}
		} else {
			console.log("No cached CodeAgent models available")
		}
	}

	// Convert the Record<string, Partial<OpenRouterModelInfo>> to Record<string, OpenRouterModelInfo>
	// by filling in any missing required fields with defaults
	const typedModels: Record<string, OpenRouterModelInfo> = {}
	for (const [key, model] of Object.entries(models)) {
		typedModels[key] = {
			maxTokens: model.maxTokens,
			contextWindow: model.contextWindow,
			supportsImages: model.supportsImages,
			supportsPromptCache: model.supportsPromptCache ?? false,
			inputPrice: model.inputPrice,
			outputPrice: model.outputPrice,
			cacheWritesPrice: model.cacheWritesPrice,
			cacheReadsPrice: model.cacheReadsPrice,
			description: model.description,
			thinkingConfig: model.thinkingConfig,
			supportsGlobalEndpoint: model.supportsGlobalEndpoint,
			tiers: model.tiers || [],
		}
	}

	return OpenRouterCompatibleModelInfo.create({ models: typedModels })
}
