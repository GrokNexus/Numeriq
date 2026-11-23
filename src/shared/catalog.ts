export interface CatalogMember { id: string; name: string }
export interface HierarchyNode { memberId: string; name: string; parentId: string | null }
export interface HierarchyVersion { version: number; createdAt: string; nodes: HierarchyNode[] }
export interface Hierarchy { id: string; name: string; versions: HierarchyVersion[] }
export interface Dimension { id: string; name: string; binding: 'accounts' | 'departments' | null; members: CatalogMember[]; hierarchies: Hierarchy[] }
export interface Model { id: string; name: string; dimensions: Dimension[] }
export interface Application { id: string; name: string; models: Model[] }
export type Catalog = Application[];
