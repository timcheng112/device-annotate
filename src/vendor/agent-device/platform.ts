// Derive platform types from the pinned public selector API; no runtime client import.
import type { isNodeEditable } from 'agent-device/selectors';
export type Platform = Parameters<typeof isNodeEditable>[1];
export type PublicPlatform = Platform;
