import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const c1 = await prisma.company.upsert({
    where: { slug: 'doordash' },
    update: {},
    create: {
      slug: 'doordash',
      name: 'DoorDash',
      description: 'DoorDash is a technology company that connects people with the best in their cities.',
      vcBacker: 'YCombinator',
      industry: 'Consumer',
      employees: '5000+',
      seedRound: 'Seed',
      raised: '$2.5B',
      website: 'https://doordash.com',
      founders: {
        create: [
          {
            name: 'Tony Xu',
            role: 'CEO & Co-founder',
            email: 'tony@doordash.com',
            socialLinks: 'https://linkedin.com/in/tony',
          },
          {
            name: 'Andy Fang',
            role: 'CTO & Co-founder',
            email: 'andy@doordash.com',
          }
        ]
      }
    }
  })

  const c2 = await prisma.company.upsert({
    where: { slug: 'airbnb' },
    update: {},
    create: {
      slug: 'airbnb',
      name: 'Airbnb',
      description: 'Airbnb is an online marketplace for lodging, primarily homestays for vacation rentals, and tourism activities.',
      vcBacker: 'a16z',
      industry: 'Tech',
      employees: '1000-5000',
      seedRound: 'Pre-Seed',
      raised: '$6.4B',
      website: 'https://airbnb.com',
      founders: {
        create: [
          {
            name: 'Brian Chesky',
            role: 'CEO',
          }
        ]
      }
    }
  })

  console.log({ c1, c2 })
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
