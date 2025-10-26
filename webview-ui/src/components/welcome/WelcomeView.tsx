import { BooleanRequest, EmptyRequest } from "@shared/proto/cline/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { memo, useEffect, useState } from "react"
import ClineLogoWhite from "@/assets/ClineLogoWhite"
import ApiOptions from "@/components/settings/ApiOptions"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AccountServiceClient, StateServiceClient } from "@/services/grpc-client"
import { validateApiConfiguration } from "@/utils/validate"

const WelcomeView = memo(() => {
	const { apiConfiguration, mode } = useExtensionState()
	const [apiErrorMessage, setApiErrorMessage] = useState<string | undefined>(undefined)
	const [showApiOptions, setShowApiOptions] = useState(false)

	const disableLetsGoButton = apiErrorMessage != null

	const handleLogin = () => {
		AccountServiceClient.accountLoginClicked(EmptyRequest.create()).catch((err) =>
			console.error("Failed to get login URL:", err),
		)
	}

	const handleSubmit = async () => {
		try {
			await StateServiceClient.setWelcomeViewCompleted(BooleanRequest.create({ value: true }))
		} catch (error) {
			console.error("Failed to update API configuration or complete welcome view:", error)
		}
	}

	useEffect(() => {
		setApiErrorMessage(validateApiConfiguration(mode, apiConfiguration))
	}, [apiConfiguration, mode])

	return (
		<div className="fixed inset-0 p-0 flex flex-col">
			<div className="h-full px-5 overflow-auto">
				<h2>Hi, I'm CodeAgent</h2>
				<div className="flex justify-center my-5">
					<ClineLogoWhite className="size-16" />
				</div>
				<p>
					I can do all kinds of tasks thanks to breakthroughs in agentic coding capabilities and access to tools that
					let me create & edit files, explore complex projects, use a browser, and execute terminal commands{" "}
					<i>(with your permission, of course)</i>. I can even use MCP to create new tools and extend my own
					capabilities.
				</p>
				<p className="text-[var(--vscode-descriptionForeground)]">
					Note: CodeAgent is forked from Cline and customized for enhanced agentic coding management tracing.
				</p>{" "}
				<div className="mt-4.5">
					<div>
						<ApiOptions currentMode={mode} showModelOptions={false} />
						<VSCodeButton className="mt-0.75" disabled={disableLetsGoButton} onClick={handleSubmit}>
							Let's go!
						</VSCodeButton>
					</div>
				</div>
			</div>
		</div>
	)
})

export default WelcomeView
