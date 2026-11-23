/** Client view of the estate graph JSON, schema migration-studio/estate-graph/v1 (scanner/estate/graph.py). */
export const GRAPH_SCHEMA = 'migration-studio/estate-graph/v1';

export interface GraphOutput {
  id: string;
  name: string;
  is_error: boolean;
}

export interface GraphNode {
  id: string;
  kind: 'executable' | 'event_handler' | 'component';
  name: string;
  parent: string | null;
  // executables and event handlers
  category?: string;
  exec_type?: string | null;
  disabled?: boolean;
  description?: string | null;
  connection?: string | null;
  // components (data-flow)
  class_id?: string | null;
  role?: string | null;
  data_flow?: string | null;
  table?: string | null;
  outputs?: GraphOutput[];
  // shared
  sql: string | null;
  sql_length: number;
  sql_truncated: boolean;
}

export interface GraphEdge {
  id: string;
  kind: 'precedence' | 'path';
  from: string;
  to: string;
  // precedence
  value?: string;
  eval_op?: string;
  expression?: string | null;
  logical_and?: boolean;
  scope?: string | null;
  // path
  from_output?: string;
  to_input?: string;
  name?: string | null;
  is_error?: boolean;
  data_flow?: string | null;
}

export interface GraphConnection {
  name: string;
  dts_id?: string | null;
  creation_name?: string | null;
  connection_string?: string | null;
  property_expression?: string | null;
  server?: string | null;
  database?: string | null;
}

export interface GraphVariable {
  name: string;
  scope?: string | null;
  data_type?: string | null;
  value?: string | null;
}

export interface GraphDoc {
  schema: string;
  package_id: string;
  package_name: string;
  source_file?: string | null;
  format_version?: string | null;
  encoding?: string | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  connections: GraphConnection[];
  variables: GraphVariable[];
  parameters: GraphVariable[];
  stats: { nodes: number; edges: number; truncated_sql: number };
  warnings: string[];
}
