import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Notification, CallToolRequestSchema, ListToolsRequestSchema, LoggingMessageNotification, ToolListChangedNotification, JSONRPCNotification, JSONRPCError, isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "crypto";
import { Request, Response } from "express"



const SESSION_ID_HEADER_NAME = "mcp-session-id"
const JSON_RPC = "2.0"


export class MCPServer {
    server: Server
    transports: {[sessionId: string]: StreamableHTTPServerTransport} = {}

    private toolInterval: NodeJS.Timeout | undefined
    private singleGreetToolName = "single-greet"
    private multiGreetToolName = "multi-great"

    constructor(server:Server){
        this.server=server
        this.configureTools()
    }



    private configureTools(){
        const setToolSchema = () => this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            this.singleGreetToolName = `single-greeting-${randomUUID()}`
            // tool that returns a single greeting
            const singleGreetTool = {
                name: this.singleGreetToolName,
                description: "Greet the user once.",
                inputSchema: {
                    type: "object",
                    properties: {
                        name: {
                            type: "string" ,
                            description: "name to greet"
                        },
                    },
                    required: ["name"]
                }
            }
                        // tool that sends multiple greetings with notifications
            const multiGreetTool = {
                name: this.multiGreetToolName,
                description: "Greet the user multiple times with delay in between.",
                inputSchema: {
                    type: "object",
                    properties: {
                        name: {
                            type: "string" ,
                            description: "name to greet"
                        },
                    },
                    required: ["name"]
                }
            }
            return {
                tools: [singleGreetTool, multiGreetTool]
            }
        })
        setToolSchema()
        // set tools dynamically, changing 5 second
        this.toolInterval = setInterval(async () => {
            setToolSchema()
            // to notify client that the tool changed
            Object.values(this.transports).forEach((transport) => {

                const notification: ToolListChangedNotification = {
                    method: "notifications/tools/list_changed",
                }
                this.sendNotification(transport, notification)
            })
        }, 5000)
        this.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
            console.log("tool request received: ", request)
            console.log("extra: ", extra)
            const args = request.params.arguments
            const toolName = request.params.name
            const sendNotification = extra.sendNotification
            if (!args) {
                throw new Error("arguments undefined")
            }

            if (!toolName) {
                throw new Error("tool name undefined")
            }
            if (toolName === this.singleGreetToolName) {

                const { name } = args

                if (!name) {
                    throw new Error("Name to greet undefined.")
                }

                return {
                    content: [ {
                        type: "text",
                        text: `Hey ${name}! Welcome to itsuki's world!`
                    }]
                }
            }
            if (toolName === this.multiGreetToolName) {
                const { name } = args
                const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
                let notification: LoggingMessageNotification = {
                    method: "notifications/message",
                    params: { level: "info", data: `First greet to ${name}` }
                }
                await sendNotification(notification)

                await sleep(1000)

                notification.params.data = `Second greet to ${name}`
                await sendNotification(notification);

                await sleep(1000)

                return {
                    content: [ {
                        type: "text",
                        text: `Hope you enjoy your day!`
                    }]
                }
            }

            throw new Error("Tool not found")  
        })

    }
    // Handle GET requests for SSE streams (using built-in support from StreamableHTTP)
    async handleGetRequest(req: Request, res: Response) {
        console.log("get request received")
        // if server does not offer an SSE stream at this endpoint.
        // res.status(405).set('Allow', 'POST').send('Method Not Allowed')

        const sessionId = req.headers['mcp-session-id'] as string | undefined
        if (!sessionId || !this.transports[sessionId]) {
            res.status(400).json(this.createErrorResponse("Bad Request: invalid session ID or method."))
            return
        }
        // Check for Last-Event-ID header for resumability
        //This will only works if we implement the eventstore and initialse it in the transport
        // if (lastEventId) {
        // const lastEventId = req.headers['last-event-id'] as string | undefined;
        //     console.log(`Client reconnecting with Last-Event-ID: ${lastEventId}`);
        // } else {
        //     console.log(`Establishing new SSE stream for session ${sessionId}`);
        // }

        console.log(`Establishing SSE stream for session ${sessionId}`)
        const transport = this.transports[sessionId]
        await transport.handleRequest(req, res)
        return
    }


    async handlePostRequest(req: Request, res: Response) {
        const sessionId = req.headers[SESSION_ID_HEADER_NAME] as string | undefined
        console.log("post request received")
        console.log("body: ", req.body)
        let transport: StreamableHTTPServerTransport
        try{
            if (sessionId && this.transports[sessionId]) {
                // Reuse existing transport
                transport = this.transports[sessionId]
                await transport.handleRequest(req, res, req.body)
                return
            }else if (!sessionId && isInitializeRequest(req.body)) {
                // todo implement eventstore to enable resumability of session
                transport = new StreamableHTTPServerTransport({
                    // for stateless mode:
                    // sessionIdGenerator: () => undefined
                    sessionIdGenerator: () => randomUUID(),
                    onsessioninitialized: (sessionId) => {
                      // Store the transport by session ID when session is initialized
                      // This avoids race conditions where requests might come in before the session is stored
                      console.log(`Session initialized with ID: ${sessionId}`);
                      this.transports[sessionId] = transport;
                    }
                })
                      // Set up onclose handler to clean up transport when closed
                transport.onclose = () => {
                    console.log("Closing transport...")
                    const sid = transport.sessionId;
                    if (sid && this.transports[sid]) {
                        console.log(`Transport closed for session ${sid}, removing from transports map`);
                        delete this.transports[sid];
                    }
                }
                await this.server.connect(transport)
                await transport.handleRequest(req, res, req.body)
                return

            }else {
                // Invalid request - no session ID or not initialization request
                res.status(400).json(this.createErrorResponse("Bad Request: invalid session ID or method."))
                return
              }

        }catch(err:unknown){
            console.error('Error handling MCP request:', err)
            res.status(500).json(this.createErrorResponse("Internal server error:"))
            return

        }
    
    }
    async handleDeleteRequest(req:Request,res:Response){
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        if (!sessionId || !this.transports[sessionId]) {
          res.status(400).send('Invalid or missing session ID')
          return
        }
        console.log(`Received session termination request for session ${sessionId}`)
        try {
            const transport = this.transports[sessionId];
            await transport.handleRequest(req, res);
          } catch (error) {
            console.error('Error handling session termination:', error);
            if (!res.headersSent) {
              res.status(500).send('Error processing session termination');
            }
        }
    }

    async cleanup(){
        this.toolInterval?.close()
        console.log("==============================closing all sessions=====================================================")
        for (const sessionId in this.transports) {
            try{
                console.log(`Closing transport for session ${sessionId}`);
                await this.transports[sessionId].close()
                delete this.transports[sessionId]
            }catch(err:unknown){
                console.error(`Error closing transport for session ${sessionId}:`, err)
            }
        }
        console.log("closed all session...")
        console.log("======================================closing the server=======================================")
        await this.server.close()
        console.log("closed the server...")
    }

    private async sendNotification(transport: StreamableHTTPServerTransport, notification: Notification) {
        const rpcNotificaiton: JSONRPCNotification = {
            ...notification,
            jsonrpc: JSON_RPC,
        }
        await transport.send(rpcNotificaiton)
    }

    private createErrorResponse(message: string): JSONRPCError {
        return {
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: message,
            },
            id: randomUUID(),
        }
    }
}


