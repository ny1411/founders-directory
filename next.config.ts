import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";
import { IMAGE_CONFIG, IMAGE_DECODER_CONFIG } from "./src/lib/image-policy";

const nextConfig: NextConfig = {
  images: IMAGE_CONFIG,
  experimental: IMAGE_DECODER_CONFIG,
};

export default withBotId(nextConfig);
