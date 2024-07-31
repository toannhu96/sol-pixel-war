import dotenvx from "@dotenvx/dotenvx";
dotenvx.config();
import express from "express";
import http from "http";
import cors from "cors";
import morgan from "morgan";
import { createCanvas } from "canvas";
import { prisma } from "./services/db.js";
import { createTerminus } from "@godaddy/terminus";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  clusterApiUrl,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { ACTIONS_CORS_HEADERS_MIDDLEWARE, createPostResponse } from "@solana/actions";
import { uuidv7 } from "uuidv7";

const PORT = process.env.PORT || 3000;
const DEFAULT_SOL_ADDRESS = new PublicKey(process.env.DEFAULT_SOL_ADDRESS);
const DEFAULT_SOL_AMOUNT = Number(process.env.DEFAULT_SOL_AMOUNT);
const connection = new Connection(clusterApiUrl("mainnet-beta"));
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

const app = express();
app.set("trust proxy", 1);
app.use(morgan("tiny"));
app.use(cors(ACTIONS_CORS_HEADERS_MIDDLEWARE));
app.use(express.json());

app.get("/api/get-image", async (req, res) => {
  const imageId = Number(req.query.image || "1");
  if (!imageId) {
    return res.status(400).json({ message: "Invalid image id" });
  }
  const gridSize = 26;
  const offset = 20; // Offset for the ordinal numbers
  const canvasSize = gridSize * 20 + offset; // Calculate canvas size
  const cellSize = (canvasSize - offset) / gridSize;

  try {
    const canvas = createCanvas(canvasSize, canvasSize);
    const ctx = canvas.getContext("2d");

    const pixels = await prisma.imagePixel.findMany({
      where: {
        imageId,
      },
    });

    // Draw pixels
    pixels.forEach((pixel) => {
      ctx.fillStyle = pixel.color;
      ctx.fillRect(pixel.positionX * cellSize + offset, pixel.positionY * cellSize + offset, cellSize, cellSize);
    });

    // Draw grid and ordinal numbers
    ctx.strokeStyle = "#ccc";
    // ctx.font = "10px Arial";
    ctx.fillStyle = "#000";

    for (let i = 0; i <= gridSize; i++) {
      const pos = i * cellSize + offset;

      // Draw vertical grid lines
      ctx.beginPath();
      ctx.moveTo(pos, offset);
      ctx.lineTo(pos, canvasSize);
      ctx.stroke();

      // Draw horizontal grid lines
      ctx.beginPath();
      ctx.moveTo(offset, pos);
      ctx.lineTo(canvasSize, pos);
      ctx.stroke();

      // Draw ordinal numbers aligned with the grid lines
      if (i < gridSize) {
        ctx.fillText(String.fromCharCode(65 + i), pos + cellSize / 2 - 3, offset - 5); // Top numbers (1-based index)
        ctx.fillText(i, offset - 15, pos + cellSize / 2 + 3); // Left letters (A-Z)
      }
    }

    res.setHeader("Content-Type", "image/png");
    canvas.createPNGStream().pipe(res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err?.message || err });
  }
});

app.post("/webhook", [adminAuthMiddleware], async (req, res) => {
  const payload = req.body;
  try {
    const logs = payload?.[0]?.meta?.logMessages;
    const txHash = payload?.[0]?.transaction?.signatures?.[0];
    const memoLog = logs.find((log) => log.includes("Program log: Memo "));
    const match = memoLog.match(/: "([^"]+)"/);
    if (!match) {
      console.log("Invalid input format", memoLog);
      res.status(400).json({ message: "Invalid input format" });
    }

    const parts = match[1].split(":");
    if (parts.length !== 3) {
      console.log("Invalid input format", memoLog);
      res.status(400).json({ message: "Invalid input format" });
    }
    const row = parts[0];
    const column = parts[1];
    const color = parts[2];

    await drawPixel(row, column, color, txHash);

    res.json({ message: "Webhook received successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err?.message || err });
  }
});

// For Blink Action
app.get("/actions.json", getActionsJson);
app.get("/api/actions/draw", getDrawPixel);
app.post("/api/actions/draw", postDrawPixel);

// Route handlers
function getActionsJson(req, res) {
  const payload = {
    rules: [
      { pathPattern: "/*", apiPath: "/api/actions/*" },
      { pathPattern: "/api/actions/**", apiPath: "/api/actions/**" },
    ],
  };
  res.json(payload);
}

async function getDrawPixel(req, res) {
  try {
    const payload = {
      title: "Solana Pixel War",
      icon: `${BASE_URL}/api/get-image`,
      description: "Pixel War: Unite, Create, Conquer! Start to draw your pixel with community now!",
      links: {
        actions: [
          {
            label: "Draw",
            href: `${BASE_URL}/api/actions/draw?data={data}`,
            parameters: [
              {
                name: "data",
                label: `Enter value. Eg: A:1:#FF0000 or A:1:red `,
                required: true,
              },
            ],
          },
        ],
      },
    };

    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err?.message || err });
  }
}

async function postDrawPixel(req, res) {
  try {
    const toPubkey = DEFAULT_SOL_ADDRESS;
    const { data } = validatedQueryParams(req.query);
    const { account } = req.body;

    if (!account) {
      throw new Error('Invalid "account" provided');
    }

    const fromPubkey = new PublicKey(account);

    // create an instruction to transfer native SOL from one wallet to another
    const transferSolInstruction = SystemProgram.transfer({
      fromPubkey: fromPubkey,
      toPubkey: toPubkey,
      lamports: DEFAULT_SOL_AMOUNT * LAMPORTS_PER_SOL,
    });

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

    // create a legacy transaction
    const transaction = new Transaction({
      feePayer: fromPubkey,
      blockhash,
      lastValidBlockHeight,
    }).add(transferSolInstruction);

    transaction.add(
      new TransactionInstruction({
        keys: [{ pubkey: fromPubkey, isSigner: true, isWritable: true }],
        data: Buffer.from(data, "utf-8"),
        programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
      }),
    );

    const payload = await createPostResponse({
      fields: {
        transaction,
        message: `Successfully draw pixel, please refresh the page to see the changes.`,
      },
      // note: no additional signers are needed
      // signers: [],
    });

    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message || "An unknown error occurred" });
  }
}

function validatedQueryParams(query) {
  try {
    if (!query.data) {
      throw new Error("Missing required input query parameter: data");
    }
    const data = String(query.data).split(":");
    if (data.length !== 3) {
      throw new Error("Invalid input query parameter: data");
    }
  } catch (err) {
    throw new Error("Invalid input query parameter: data");
  }

  return { data: query.data };
}

async function drawPixel(x, y, color, tx, imageId = 1) {
  if (!x || !y || !color || !tx) {
    throw new Error("Invalid input parameters");
  }

  try {
    await prisma.$transaction([
      prisma.imagePixel.upsert({
        where: {
          imageId_positionX_positionY: {
            imageId,
            positionX: String(x).charCodeAt(0) - 65,
            positionY: Number(y),
          },
        },
        create: {
          positionX: String(x).charCodeAt(0) - 65,
          positionY: Number(y),
          imageId,
          color,
          tx,
          imageId,
        },
        update: {
          color,
          tx,
        },
      }),
      prisma.txLog.create({
        data: {
          id: uuidv7(),
          tx,
        },
      }),
    ]);
  } catch (err) {
    console.error(err);
  }
}

function adminAuthMiddleware(req, res, next) {
  try {
    const authHeader = req.header("authorization");
    if (authHeader === process.env.ADMIN_API_KEY) {
      return next();
    }
    res.status(401).json({ message: "Unauthorized access" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err?.message || err });
  }
}

function onHealthCheck() {
  return Promise.resolve();
}

function onSignal() {
  console.log("server is starting cleanup");
  // close db connections, etc
  return Promise.all([
    prisma
      .$disconnect()
      .then(() => console.log("postgres disconnected successfully"))
      .catch((err) => console.error("error during postgres disconnection", err.stack)),
  ]);
}

function onShutdown() {
  console.log("cleanup finished, server is shutting down");
  return Promise.resolve();
}

const terminusOptions = {
  signals: ["SIGINT", "SIGTERM"],
  timeout: 10000,
  healthChecks: { "/": onHealthCheck },
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
  },
  onSignal,
  onShutdown,
};

const server = http.createServer(app);

// graceful shutdown
createTerminus(server, terminusOptions);

server.listen(PORT, () => {
  console.log(`Server is running on port :${PORT}`);
});
