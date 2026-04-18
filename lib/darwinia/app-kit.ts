/**
 * Circle App Kit — server-side singleton
 *
 * Provides bridge / send / swap capabilities backed by Circle Developer
 * Controlled Wallets. Used in Darwinia on Arc for:
 *   - Bridging USDC from other testnets → Arc Testnet (top-up flow)
 *   - Sending USDC between wallets
 *   - Querying supported chains / tokens
 *
 * @see https://docs.arc.network/app-kit
 */

import { AppKit, Blockchain } from '@circle-fin/app-kit';
import { createCircleWalletsAdapter } from '@circle-fin/adapter-circle-wallets';

let _kit: AppKit | null = null;

export function getAppKit(): AppKit {
  if (_kit) return _kit;

  const apiKey = process.env.CIRCLE_APP_KIT_KEY || process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;

  if (!apiKey || !entitySecret) {
    throw new Error('CIRCLE_APP_KIT_KEY and CIRCLE_ENTITY_SECRET are required');
  }

  const adapter = createCircleWalletsAdapter({ apiKey, entitySecret });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _kit = new AppKit({ adapter } as any);
  return _kit;
}

/** Arc Testnet blockchain identifier in the App Kit enum */
export const ARC_TESTNET_CHAIN = Blockchain.Arc_Testnet;

/** All chains App Kit currently supports */
export async function getSupportedChains() {
  const kit = getAppKit();
  return kit.getSupportedChains();
}
