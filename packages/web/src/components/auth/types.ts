export interface LoginClipboardNode {
  id: string;
  title: string;
  content: string;
  nodeLabel: string;
  createdAt: string;
  speedLevel: number;
}

export interface SceneNode {
  id: string;
  label: string;
  speedLevel: number;
  basePosition: {
    x: number;
    y: number;
    z: number;
  };
}

export interface NodeProjection {
  id: string;
  label: string;
  x: number;
  y: number;
  visible: boolean;
}
