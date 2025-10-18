import { ensureCacheDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import { EmptyRequest } from "@shared/proto/cline/common"
import { CodeAgentCompatibleModelInfo, CodeAgentModelInfo } from "@shared/proto/cline/models"
import { fileExistsAtPath } from "@utils/fs"
import axios from "axios"
import fs from "fs/promises"
import path from "path"
import { Logger } from "@/services/logging/Logger"
import { Controller } from ".."

/**
 * Reads cached CodeAgent models from disk
 */
async function readCodeAgentModels(): Promise<Record<string, CodeAgentModelInfo> | null> {
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
): Promise<CodeAgentCompatibleModelInfo> {
	console.log("=== refreshCodeAgentModels called ===")
	const codeagentModelsFilePath = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.codeagentModels)

	// Get the CodeAgent API key and base URL from the controller's state
	const apiConfiguration = controller.stateManager.getApiConfiguration()
	const codeagentApiKey = apiConfiguration?.codeagentApiKey
	const codeagentBaseUrl = apiConfiguration?.codeagentBaseUrl

	const models: Record<string, CodeAgentModelInfo> = {}

	try {
		if (!codeagentApiKey || !codeagentBaseUrl) {
			console.log("No CodeAgent API key or base URL found, using empty model list")
			// Return empty models - user needs to configure both API key and base URL
		} else {
			// Ensure the API key and base URL are properly formatted
			const cleanApiKey = codeagentApiKey.trim()
			let cleanBaseUrl = codeagentBaseUrl.trim().replace(/\/+$/, "")

			// Validate URL format (http|https)://domain
			if (!cleanBaseUrl.match(/^https?:\/\//i)) {
				throw new Error("CodeAgent Base URL must start with http:// or https://")
			}

			// Extract only protocol and host (remove any paths)
			const urlObj = new URL(cleanBaseUrl)
			cleanBaseUrl = `${urlObj.protocol}//${urlObj.host}`

			if (!cleanApiKey || !cleanBaseUrl) {
				Logger.log("Invalid CodeAgent API key or base URL after cleaning")
				throw new Error("Invalid CodeAgent API key or base URL format")
			}

			Logger.log("Fetching CodeAgent models from API")

			Logger.log(`Using CodeAgent Base URL: ${cleanBaseUrl}`)
			Logger.log(`Using CodeAgent API Key: ${cleanApiKey.substring(0, 4)}****`)

			// Construct the models endpoint URL - use /api/models endpoint
			const modelsUrl = `${cleanBaseUrl}/api/models`

			const response = await axios.get(modelsUrl, {
				headers: {
					Authorization: `Bearer ${cleanApiKey}`,
					"Content-Type": "application/json",
					"User-Agent": "Cline-VSCode-Extension",
				},
				timeout: 15000, // 15 second timeout
			})

			Logger.log(`CodeAgent models API response status: ${response.status}`)
			Logger.log(`CodeAgent models API response status: ${response.data}`)

			if (response.data) {
				const rawModels = response.data

				for (const rawModel of rawModels) {
					// Map CodeAgent backend response to CodeAgentModelInfo schema
					const modelInfo: CodeAgentModelInfo = {
						id: rawModel.id,
						modelId: rawModel.modelId || rawModel.id,
						displayName: rawModel.displayName || rawModel.display_name || rawModel.id,
						endpoint: rawModel.endpoint || "",
						apiKey: rawModel.apiKey || rawModel.api_key,
						deploymentName: rawModel.deploymentName || rawModel.deployment_name || "",
						status: rawModel.status || "ACTIVE",
						apiVersion: rawModel.apiVersion || rawModel.api_version || "2024-02-01",
						inputTokensPer1m: rawModel.pricing?.inputTokensPer1m || rawModel.pricing?.input_tokens_per_1m || 0,
						outputTokensPer1m: rawModel.pricing?.outputTokensPer1m || rawModel.pricing?.output_tokens_per_1m || 0,
						cachedInputTokensPer1m:
							rawModel.pricing?.cachedInputTokensPer1m || rawModel.pricing?.cached_input_tokens_per_1m || 0,
						createdAt: rawModel.createdAt || rawModel.created_at || new Date().toISOString(),
						updatedAt: rawModel.updatedAt || rawModel.updated_at || new Date().toISOString(),
						description: rawModel.description || "",
						supportImage: rawModel.supportImage || false,
					}

					models[rawModel.id] = modelInfo
				}

				Logger.log(`Saving ${Object.keys(models).length} CodeAgent models to cache`)

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

	return CodeAgentCompatibleModelInfo.create({ models })
}
