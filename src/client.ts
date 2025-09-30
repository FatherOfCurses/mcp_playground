import "dotenv/config"
import { confirm, input, select } from "@inquirer/prompts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CreateMessageRequestSchema, Prompt, PromptMessage, Tool } from "@modelcontextprotocol/sdk/types.js";
import { generateText, jsonSchema, stepCountIs, ToolSet } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

const mcp = new Client(
    {
        name: "test-client",
        version: "1.0.0",
    },
    {
        capabilities: { sampling: {} }
    }
)

const transport = new StdioClientTransport({
    command: "node",
    args: ["./build/server.js"],
    stderr: "ignore" // ignore errors because we're using experimental node features
})

const google = createGoogleGenerativeAI({
    apiKey: process.env.GEMINI_API_KEY
})

async function main() {
    await mcp.connect(transport)
    const [{ tools }, { prompts }, { resources }, { resourceTemplates }] = await Promise.all([
        mcp.listTools(),                              // we're getting everything the server has
        mcp.listPrompts(),                            // and putting them into config objects
        mcp.listResources(),
        mcp.listResourceTemplates()
    ])

    mcp.setRequestHandler(CreateMessageRequestSchema, async (request) => {
        const texts: string[] = []
        for (const message of request.params.messages) {
            const text = await handleServerMessagePrompt(message)
            if (text != null) texts.push(text)
        }

        return {
            role: "user",
            model: "gemini-2.0-flash",
            stopReason: "endTurn",
            content: {
                type: "text",
                text: texts.join("\n")
            }
        }
    })

    console.log("Connected")
    while (true) {
        const option = await select({
            message: "What do you want to do?",
            choices: ["Query", "Tools", "Resources", "Prompts"]
        })  // for now this is outputting to the console

        switch (option) {
            case "Tools":
                const toolName = await select({
                    message: "Select a tool",
                    choices: tools.map(tool => ({      // get list of tools and display
                        name: tool.annotations?.title || tool.name,
                        value: tool.name,
                        description: tool.description
                    }))
                })
                const tool = tools.find(tool => tool.name === toolName)
                if (tool == null) {
                    console.error("Tool not found")
                } else {
                    await handleTool(tool)
                }
                break
            case "Resources":
                const resourceUri = await select({
                    message: "Select a resource",
                    choices: [
                        ...resources.map(resource => ({
                            name: resource.name,
                            value: resource.uri,
                            description: resource.description
                        })),
                        ...resourceTemplates.map(template => ({
                            name: template.name,
                            value: template.uriTemplate,
                            description: template.description
                        })),
                    ],
                })
                const uri =
                    resources.find(resource => resource.uri === resourceUri)?.uri ??
                    resourceTemplates.find(template => template.uriTemplate === resourceUri)?.uriTemplate
                if (uri == null) {
                    console.error("Resource not found")
                } else {
                    await handleResource(uri)
                }
                break
            case "Prompts":
                const promptName = await select({
                    message: "Select a prompt",
                    choices: prompts.map(prompt => ({      // get list of prompts and display
                        name: prompt.name,
                        value: prompt.name,
                        description: prompt.description
                    })),
                })
                const prompt = prompts.find(prompt => prompt.name === promptName)
                if (prompt == null) {
                    console.error("Prompt not found")
                } else {
                    await handlePrompt(prompt)
                }
                break
            case "Query":
                await handleQuery(tools)
        }
    }
}

async function handleQuery(tools: Tool[]) {
    const query = await input({ message: "Enter your query" })

    const { text, toolResults, steps } = await generateText({
        model: google("gemini-2.0-flash"),
        prompt: query,
        stopWhen: stepCountIs(5),
        tools: tools.reduce(
            (obj, tool) => ({
                ...obj,
                [tool?.name]: {
                    description: tool?.description,
                    inputSchema: jsonSchema(tool?.inputSchema),
                    execute: async (args: Record<string, any>) => {
                        return await mcp.callTool({
                            name: tool?.name,
                            arguments: args,
                        });
                    },
                },
            }),
            {} as ToolSet
        ),
    })

    console.log(
        // @ts-expect-error
        text || toolResults[0]?.result?.content[0]?.text || "No text generated."
    )
}

async function handleTool(tool: Tool) {
    const args: Record<string, string> = {}
    for (const [key, value] of Object.entries(tool.inputSchema.properties ?? {})) {
        args[key] = await input({
            message: `Enter value for ${key} (${(value as { type: string }).type}):`
            // looping through the params defined on the server and asking for input
        })
    }

    const res = await mcp.callTool({
        name: tool.name,
        arguments: args
    })  // parse out what was obtained from the args above

    console.log((res.content as [{ text: string }])[0].text)
}

async function handleResource(uri: string) {
    let finalUri = uri
    const paramMatches = uri.match(/{([^}]+)}/g)

    if (paramMatches != null) {
        for (const paramMatch of paramMatches) {
            const paramName = paramMatch.replace("{", "").replace("}", "")
            const paramValue = await input({
                message: `Enter value for ${paramName}:`
            })
            finalUri = finalUri.replace(paramMatch, paramValue)
        }
    }

    const res = await mcp.readResource({
        uri: finalUri
    })  // parse out what was obtained from the args above

    console.log(
        JSON.stringify(JSON.parse(res.contents[0].text as string), null, 2)
    )
}

async function handlePrompt(prompt: Prompt) {
    const args: Record<string, string> = {}
    for (const arg of prompt.arguments ?? []) {
        args[arg.name] = await input({
            message: `Enter value for ${arg.name}:`
            // looping through the params defined on the server and asking for input
        })
    }

    const response = await mcp.getPrompt({
        name: prompt.name,
        arguments: args
    })  // parse out what was obtained from the args above

    for (const message of response.messages) {
        console.log(await handleServerMessagePrompt(message))
    }
}

async function handleServerMessagePrompt(message: PromptMessage) {
    if (message.content.type !== "text") return

    console.log(message.content.text)
    const run = await confirm({   // from inquirer - simple yes/no prompt
        message: "Do you want to run this?",
        default: true
    })

    if (!run) return

    const { text } = await generateText({
        model: google("gemini-2.0-flash"),
        prompt: message.content.text,
    })

    return text
}

main()