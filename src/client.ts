import { input, select } from "@inquirer/prompts";
import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { describe } from "node:test";

const mcp = new Client({
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

async function main() {
    await mcp.connect(transport)
    const [{ tools }, { prompts }, { resources }, { resourceTemplates }] = await Promise.all([
        mcp.listTools(),                              // we're getting everything the server has
        mcp.listPrompts(),                            // and putting them into config objects
        mcp.listResources(),
        mcp.listResourceTemplates()
    ])

    console.log("Connected")
    while (true) {
        const option = await select({
            message: "What do you want to do?",
            choices: ["Query", "Tools", "Resources", "Prompts"]
        })  // for now this is outputting to the console

        switch (option) {
            case "Tools": {
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
            }

            case "Resources": {
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
            }
        }
    }
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
            message: `Enter value for ${paramName.slice(1, -1)}:`
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

main()