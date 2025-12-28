export interface Actor {
  name: string;
  ac: number;
  hp: number;
  description: string;
  initiative: number;
  player?: boolean;
  characterSheetUrl?: string;
}

export interface ImageState {
  name: string;
  imageUrl: string;
  tags?: string; // Comma-separated tags
}

export interface Token {
  id: string;
  x?: number;
  y?: number;
  radius: number;
  gridWidth?: number; // Token width in grid squares
  gridHeight?: number; // Token height in grid squares
  color?: string;
  imageUrl?: string; // Map image (primary/default)
  portraitUrl?: string; // Portrait image for card/header
  tags?: string; // Comma-separated tags for base image
  actor?: Actor;
  active?: boolean;
  states?: ImageState[]; // Additional state images
  activeState?: string; // Currently active state name
  currentlyFacing?: 'left' | 'right'; // Horizontal facing direction
}

export interface Prop {
  id: string;
  name: string;
  description: string;
  imageUrl?: string; // Primary/default image
  tags?: string; // Comma-separated tags for base image
  x: number;
  y: number;
  radius: number;
  color: string;
  rotation?: number;
  scale?: number;
  flip?: boolean; // Horizontal flip for design purposes
  states?: ImageState[]; // Additional state images
  activeState?: string; // Currently active state name
}

export interface RevealZone {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  permanent: boolean; // If true, fog stays revealed after leaving zone
}
