import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createClient } from 'redis';

const app = express();
const PORT: number = parseInt(process.env.PORT || '3000', 10);
const CACHE_TTL = parseInt(process.env.CACHE_TTL || '60', 10);

// ── Prisma ────────────────────────────────────────────────────────────────────
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// ── Redis ─────────────────────────────────────────────────────────────────────
const redis = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redis.on('error', (err) => console.error('Redis error:', err));
redis.connect();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());

app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// ── Cache helpers ─────────────────────────────────────────────────────────────
async function getCache<T>(key: string): Promise<T | null> {
  const data = await redis.get(key);
  return data ? (JSON.parse(data) as T) : null;
}

async function setCache(key: string, value: unknown): Promise<void> {
  await redis.setEx(key, CACHE_TTL, JSON.stringify(value));
}

async function invalidateCache(...keys: string[]): Promise<void> {
  if (keys.length) await redis.del(keys);
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

app.get('/', (_req: Request, res: Response) => {
  res.json({ message: 'Welcome to CI-CD-API' });
});

// GET /products?category=Audio
app.get('/products', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { category } = req.query;
    const cacheKey = category ? `products:category:${category}` : 'products:all';

    const cached = await getCache(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      res.json(cached);
      return;
    }

    const products = await prisma.product.findMany({
      where: category ? { category: String(category) } : undefined,
      orderBy: { id: 'asc' },
    });

    await setCache(cacheKey, products);
    res.setHeader('X-Cache', 'MISS');
    res.json(products);
  } catch (err) {
    next(err);
  }
});

// GET /products/:id
app.get('/products/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid product id' });
      return;
    }

    const cacheKey = `products:${id}`;
    const cached = await getCache(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      res.json(cached);
      return;
    }

    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    await setCache(cacheKey, product);
    res.setHeader('X-Cache', 'MISS');
    res.json(product);
  } catch (err) {
    next(err);
  }
});

// POST /products
app.post('/products', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, price, description, category, stock } = req.body;

    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'name is required and must be a string' });
      return;
    }
    if (price === undefined || typeof price !== 'number' || price < 0) {
      res.status(400).json({ error: 'price is required and must be a non-negative number' });
      return;
    }

    const product = await prisma.product.create({
      data: {
        name,
        price,
        description: description ?? null,
        category: category ?? null,
        stock: stock ?? 0,
      },
    });

    const keysToInvalidate = ['products:all'];
    if (category) keysToInvalidate.push(`products:category:${category}`);
    await invalidateCache(...keysToInvalidate);
    res.status(201).json(product);
  } catch (err) {
    next(err);
  }
});

// PUT /products/:id
app.put('/products/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid product id' });
      return;
    }

    const { name, price, description, category, stock } = req.body;

    if (price !== undefined && (typeof price !== 'number' || price < 0)) {
      res.status(400).json({ error: 'price must be a non-negative number' });
      return;
    }

    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    const updated = await prisma.product.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(price !== undefined && { price }),
        ...(description !== undefined && { description }),
        ...(category !== undefined && { category }),
        ...(stock !== undefined && { stock }),
      },
    });

    await invalidateCache(`products:${id}`, 'products:all');
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /products/:id
app.delete('/products/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid product id' });
      return;
    }

    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    await prisma.product.delete({ where: { id } });
    await invalidateCache(`products:${id}`, 'products:all');
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
async function shutdown() {
  console.log('Shutting down...');
  server.close(async () => {
    await redis.quit();
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
