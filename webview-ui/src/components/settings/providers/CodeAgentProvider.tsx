import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import CodeAgentModelPicker from "../CodeAgentModelPicker"
import { ApiKeyField } from "../common/ApiKeyField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the CodeAgentProvider component
 */
interface CodeAgentProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The CodeAgent provider configuration component
 */
export const CodeAgentProvider = ({ showModelOptions, isPopup, currentMode }: CodeAgentProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	return (
		<div>
			<DebouncedTextField
				initialValue={apiConfiguration?.codeagentBaseUrl || ""}
				onChange={(value) => {
					handleFieldChange("codeagentBaseUrl", value)
				}}
				placeholder={"Enter base URL..."}
				style={{ width: "100%", marginBottom: 10 }}
				type="url">
				<span style={{ fontWeight: 500 }}>Base URL</span>
			</DebouncedTextField>

			<ApiKeyField
				helpText="This key is stored locally and only used to make API requests from this extension."
				initialValue={apiConfiguration?.codeagentApiKey || ""}
				onChange={(value) => handleFieldChange("codeagentApiKey", value)}
				providerName="CodeAgent"
			/>

			{showModelOptions && (
				<CodeAgentModelPicker baseUrl={apiConfiguration?.codeagentBaseUrl} currentMode={currentMode} isPopup={isPopup} />
			)}
		</div>
	)
}
