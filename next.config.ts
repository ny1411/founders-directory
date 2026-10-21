import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";
import { diagnoseBotIdConfiguration } from "./src/lib/bot-policy";

diagnoseBotIdConfiguration(process.env.BOTID_ENFORCEMENT_ENABLED, process.env.NEXT_PUBLIC_BOTID_ENABLED);

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
};

export default withBotId(nextConfig);
