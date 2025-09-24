import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

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
    const [{tools}, {prompts}, {resources}, {resourceTemplates}] = await Promise.all ([
        mcp.listTools(),                              // we're getting everything the server has
        mcp.listPrompts(),                            // and putting them into config objects
        mcp.listResources(),
        mcp.listResourceTemplates()                   
    ])
}

main();