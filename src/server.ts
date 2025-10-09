import fs from "node:fs/promises";
import {
	McpServer,
	ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CreateMessageResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const server = new McpServer({
	name: "test",
	version: "1.0.0",
	capabilities: {
		resources: {},
		tools: {},
		prompts: {},
	},
});

server.resource(
	"users",
	"users://all",
	{
		title: "Users",
		description: "Get all users data from the database",
		mimeType: "application/json",
	},
	async (uri) => {
		const users = await import("./data/users.json", {
			with: { type: "json" },
		}).then((m) => m.default);

		return {
			contents: [
				{
					uri: uri.href,
					text: JSON.stringify(users),
					mimeType: "application/json",
				},
			],
		};
	},
);

server.resource(
	"user-details",
	new ResourceTemplate("users://{userId}/profile", { list: undefined }),
	{
		title: "User Details",
		description: "Get a users details from the database",
		mimeType: "application/json",
	},
	async (uri, { userId }) => {
		const users = await import("./data/users.json", {
			with: { type: "json" },
		}).then((m) => m.default);
		const user = users.find((u) => u.id === parseInt(userId as string));

		if (!user) {
			return {
				contents: [
					{
						uri: uri.href,
						text: JSON.stringify({ error: "User not found" }),
						mimeType: "application/json",
					},
				],
			};
		}

		return {
			contents: [
				{
					uri: uri.href,
					text: JSON.stringify(user),
					mimeType: "application/json",
				},
			],
		};
	},
);

server.tool(
	"create-user",
	"Create a new user in the database",
	{
		name: z.string(),
		email: z.string(),
		address: z.string(),
		phone: z.string(),
	},
	{
		title: "Create user",
		readOnlyHint: false,
		destructiveHint: false,
		idempotentHint: false,
		openWorldHint: true,
	},
	async (params) => {
		try {
			const id = await createUser(params);
			return {
				content: [{ type: "text", text: `User ${id} created successfully` }],
			};
		} catch {
			return {
				content: [{ type: "text", text: "Failed to save user" }],
			};
		}
	},
);

server.tool(
	"create-random-user",
	"Create a random user with fake data",
	{
		title: "Create Random user",
		readOnlyHint: false,
		destructiveHint: false,
		idempotentHint: false,
		openWorldHint: true,
	},
	async () => {
		const res = await server.server.request(
			{
				method: "sampling/createMessage", // create a user based on existing data in the app
				params: {
					messages: [
						{
							role: "user",
							content: {
								type: "text",
								text: "Generate a fake user with a realistic name, email, address, and phone number in JSON format with the keys name, email, address, and phone.",
							},
						},
					],
					maxTokens: 1024,
				},
			},
			CreateMessageResultSchema,
		);

		if (res.content.type !== "text") {
			return {
				content: [
					{
						type: "text",
						text: "Response not text Failed to generate user data",
					},
				],
			};
		}

		try {
			const fakeUser = JSON.parse(
				// trim white space and remove markdown formatting from chat responses
				res.content.text
					.trim()
					.replace(/^```json/, "")
					.replace(/```$/, "")
					.trim(),
			);

			const id = await createUser(fakeUser);
			return {
				content: [{ type: "text", text: `User ${id} created successfully` }],
			};
		} catch {
			return {
				content: [{ type: "text", text: "Failed to generate user data" }],
			};
		}
	},
);

server.prompt(
	"generate-fake-user",
	"Generate a fake user basedon a given name",
	{
		name: z.string(),
	},
	({ name }) => {
		return {
			messages: [
				{
					role: "user",
					content: {
						type: "text",
						text: `Generate a fake user with the name ${name}. The user should have a realistic email, address, and phone number.`,
					},
				},
			],
		};
	},
);

async function createUser(user: {
	name: string;
	email: string;
	address: string;
	phone: string;
}) {
	const users = await import("./data/users.json", {
		with: { type: "json" },
	}).then((m) => m.default);
	const id = users.length + 1;

	users.push({ id, ...user });

	await fs.writeFile("./src/data/users.json", JSON.stringify(users, null, 2));

	return id;
}

async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

main();
