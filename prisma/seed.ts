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
      location: 'San Francisco, CA',
      foundedYear: 2013,

      website: 'https://doordash.com',
      twitterUrl: 'https://twitter.com/doordash',
      linkedinUrl: 'https://linkedin.com/company/doordash',
      logoUrl: 'https://logo.clearbit.com/doordash.com',
      founders: {
        create: [
          {
            name: 'Tony Xu',
            role: 'CEO & Co-founder',
            email: 'tony@doordash.com',
            twitterUrl: 'https://twitter.com/t_xu',
            linkedinUrl: 'https://linkedin.com/in/tony',
            bio: 'Tony is the CEO and Co-founder of DoorDash.',
            avatarUrl: 'https://i.pravatar.cc/150?u=tony'
          },
          {
            name: 'Andy Fang',
            role: 'CTO & Co-founder',
            email: 'andy@doordash.com',
            linkedinUrl: 'https://linkedin.com/in/andyfang',
            bio: 'Andy is the CTO and Co-founder of DoorDash.'
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
      vcBacker: 'YCombinator',
      industry: 'Tech',
      employees: '1000-5000',
      location: 'San Francisco, CA',
      foundedYear: 2008,

      website: 'https://airbnb.com',
      twitterUrl: 'https://twitter.com/airbnb',
      linkedinUrl: 'https://linkedin.com/company/airbnb',
      logoUrl: 'https://logo.clearbit.com/airbnb.com',
      founders: {
        create: [
          {
            name: 'Brian Chesky',
            role: 'CEO',
            twitterUrl: 'https://twitter.com/bchesky',
            linkedinUrl: 'https://linkedin.com/in/brianchesky',
            bio: 'Brian is the co-founder and CEO of Airbnb.',
            avatarUrl: 'https://i.pravatar.cc/150?u=brian'
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
