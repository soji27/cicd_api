import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';
dotenv.config();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
    await prisma.product.createMany({
        data: [
            { name: 'MacBook Pro',       price: 1999.99, category: 'Informatique', stock: 15 },
            { name: 'iPhone 15',         price: 999.99,  category: 'Téléphonie',   stock: 30 },
            { name: 'AirPods Pro',       price: 279.99,  category: 'Audio',        stock: 50 },
            { name: 'Samsung Galaxy S24',price: 899.99,  category: 'Téléphonie',   stock: 25 },
            { name: 'Sony WH-1000XM5',   price: 349.99,  category: 'Audio',        stock: 20 },
        ],
    });
    console.log('Seed done!');
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
