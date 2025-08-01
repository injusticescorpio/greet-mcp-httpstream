import express, { Request, Response } from "express"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { MCPServer } from "./server.js"


const server = new MCPServer(
    new Server({
        name: "arjun-mcp-server",
        version: "1.0.0"
    }, {
        capabilities: {
            tools: {},
            logging: {}
        }
    })
)

/*******************************/
/******* Endpoint Set Up *******/
/*******************************/

const app = express()
app.use(express.json())

const router = express.Router()

// endpoint for the client to use for sending messages
const MCP_ENDPOINT = "/mcp"

// handler
router.post(MCP_ENDPOINT, async (req: Request, res: Response) => {
    await server.handlePostRequest(req, res)
})

// Handle GET requests for SSE streams (using built-in support from StreamableHTTP)
router.get(MCP_ENDPOINT, async (req: Request, res: Response) => {
    await server.handleGetRequest(req, res)
})

router.delete(MCP_ENDPOINT, async (req: Request, res: Response) => {
    await server.handleDeleteRequest(req,res)
})





app.use('/', router)

const PORT = 3000
app.listen(PORT, () => {
    console.log(`MCP Streamable HTTP Server listening on port ${PORT}`)
})

process.on('SIGINT', async () => {
    console.log('Shutting down server...')
    await server.cleanup()
    process.exit(0)
})