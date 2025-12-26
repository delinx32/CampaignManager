export interface Actor {
  name: string;
  ac: number;
  hp: number;
  description: string;
  initiative: number;
  player?: boolean;
  characterSheetUrl?: string;
}

export interface Token {
  id: string;
  x?: number;
  y?: number;
  radius: number;
  color?: string;
  imageUrl?: string; // Map image
  portraitUrl?: string; // Portrait image for card/header
  actor?: Actor;
  active?: boolean;
}

export interface Prop {
  id: string;
  name: string;
  description: string;
  imageUrl?: string;
  x: number;
  y: number;
  radius: number;
  color: string;
  rotation?: number;
  scale?: number;
}
