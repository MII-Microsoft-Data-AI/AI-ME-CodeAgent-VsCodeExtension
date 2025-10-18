import { Mode } from "@shared/storage/types"
import { useCallback, useEffect, useRef, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import CodeAgentModelPicker from "../CodeAgentModelPicker"
import { ApiKeyField } from "../common/ApiKeyField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import { getModeSpecificFields, normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the OpenAICompatibleProvider component
 */
interface OpenAICompatibleProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The OpenAI Compatible provider configuration component
 */
export const CodeAgentProvider = ({ showModelOptions, isPopup, currentMode }: OpenAICompatibleProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	const [modelConfigurationSelected, setModelConfigurationSelected] = useState(false)

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	// Get mode-specific fields
	const { codeagentModelInfo } = getModeSpecificFields(apiConfiguration, currentMode)

	// Debounced function to refresh CodeAgent models (prevents excessive API calls while typing)
	const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

	useEffect(() => {
		return () => {
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current)
			}
		}
	}, [])

	const debouncedRefreshCodeAgentModels = useCallback((baseUrl?: string, apiKey?: string) => {
		if (debounceTimerRef.current) {
			clearTimeout(debounceTimerRef.current)
		}

		// CodeAgent models refresh happens via gRPC subscription on context
		// This is just for future extension if needed
	}, [])

	return (
		<div>
			<DebouncedTextField
				initialValue={apiConfiguration?.codeagentBaseUrl || ""}
				onChange={(value) => {
					handleFieldChange("codeagentBaseUrl", value)
					debouncedRefreshCodeAgentModels(value, apiConfiguration?.codeagentBaseUrl)
				}}
				placeholder={"Enter base URL..."}
				style={{ width: "100%", marginBottom: 10 }}
				type="url">
				<span style={{ fontWeight: 500 }}>Code Agent URL</span>
			</DebouncedTextField>

			<ApiKeyField
				initialValue={apiConfiguration?.codeagentApiKey || ""}
				onChange={(value) => {
					handleFieldChange("codeagentApiKey", value)
					debouncedRefreshCodeAgentModels(apiConfiguration?.codeagentApiKey, value)
				}}
				providerName="Code Agent"
			/>

			<CodeAgentModelPicker currentMode={currentMode} isPopup={isPopup} />

			<p>
				<span style={{ fontSize: "12px", color: "var(--vscode-descriptionForeground)" }}>
					The CodeAgent API key and base URL are used to connect to your CodeAgent-compatible backend. Make sure to
					provide valid credentials to access the models.
					{apiConfiguration?.codeagentBaseUrl || ""}
					{apiConfiguration?.codeagentApiKey ? "" : " (No API Key Set)"}
				</span>
			</p>

			{showModelOptions && (
				<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
			)}
		</div>
	)
}
