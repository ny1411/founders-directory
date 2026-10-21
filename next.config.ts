import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";
import { IMAGE_CONFIG, IMAGE_DECODER_CONFIG } from "./src/lib/image-policy";
import { diagnoseBotIdConfiguration } from "./src/lib/bot-policy";

diagnoseBotIdConfiguration(process.env.BOTID_ENFORCEMENT_ENABLED, process.env.NEXT_PUBLIC_BOTID_ENABLED);

const nextConfig: NextConfig = {
  images: IMAGE_CONFIG,
  experimental: IMAGE_DECODER_CONFIG,
};

export default withBotId(nextConfig);
