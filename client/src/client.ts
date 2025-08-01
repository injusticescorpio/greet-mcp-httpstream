import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { LoggingMessageNotificationSchema, ToolListChangedNotificationSchema, TextContentSchema } from "@modelcontextprotocol/sdk/types.js"



class MCPClient {
    tools: {name: string, description: string}[] = []
    private client: Client
    private transport: StreamableHTTPClientTransport | null = null
    private isCompleted = false

    constructor(serverName: string) {
        this.client = new Client({ name: `mcp-client-for-${serverName}`, version: "1.0.0" })
    }
    async connectToServer(serverUrl: string) {
        const url = new URL(serverUrl)
        try{
            this.transport = new StreamableHTTPClientTransport(url)
            await this.client.connect(this.transport)
            console.log("Connected to server")

            this.setUpTransport()
            this.setUpNotifications()

        }catch(err:unknown){
            console.log("Failed to connect to MCP server: ", err)
            throw err
        }
    }
    private setUpTransport() {
        if (this.transport === null) {
            return
        }
        this.transport.onclose = () => {
            console.log("SSE transport closed.")
            this.isCompleted = true
        }

        this.transport.onerror = async (error) => {
            console.log("SSE transport error: ", error)
            await this.cleanup()
        }
    }

    async listTools() {
        try {
            const toolsResult = await this.client.listTools()
            console.log('Available tools:', toolsResult.tools)
            this.tools = toolsResult.tools.map((tool) => {
                return {
                    name: tool.name,
                    description: tool.description ?? "",
                }
            })
        } catch (error) {
            console.log(`Tools not supported by the server (${error})`);
        }
    }

    async callTool(name: string) {
        try {
            console.log('\nCalling tool: ', name);

            const result  = await this.client.callTool({
                name: name,
                arguments: { name: "arjun"},
            })

            const content = result.content as object[]

            console.log('results:');
            content.forEach((item) => {
                const parse = TextContentSchema.safeParse(item)
                if (parse.success) {
                    console.log(`- ${parse.data.text}`);
                }
            })
        } catch (error) {
            console.log(`Error calling greet tool: ${error}`);
        }
    }
    private setUpNotifications() {
        this.client.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => {
            console.log("LoggingMessageNotificationSchema received:  ", notification)
        })
        // will only be triggered after list tools called
        this.client.setNotificationHandler(ToolListChangedNotificationSchema, async (notification) => {
            console.log("ToolListChangedNotificationSchema received:  ", notification)
            await this.listTools()
        })
    }



    async cleanup() {
        await this.client.close()
    }
    async waitForCompletion() {
        while (!this.isCompleted) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

}



async function main() {
    const client = new MCPClient("sse-server")

    try {
        await client.connectToServer("http://localhost:3000/mcp")
        await client.listTools()
        for (const tool of client.tools) {
            await client.callTool(tool.name)
        }
        await client.waitForCompletion()
    } finally {
        await client.cleanup()
    }
}

main()