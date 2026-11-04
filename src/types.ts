import type { z } from 'zod';
import { trajectorySchema } from '../shared/schema.mjs';

export type Trajectory = z.infer<typeof trajectorySchema>;
export type ProcessNode = Trajectory['nodes'][number];
export type Provenance = ProcessNode['provenance'];
export type InputKey = 'goals' | 'constraints' | 'background' | 'human_choices';
export interface Provider {
  configured: boolean; model: string | null; config_error: string | null;
  max_input_characters: number; max_input_bytes: number; schema_version: string;
}
export interface Example { id: string; name: string; description: string; content: string }
export interface Summary {
  id: string; title: string; created_at: string; revision: number; review_status: string;
  extraction_status: string; narrative_origin: string; node_count: number;
}
export interface Attempt {
  id: string; status: string; mode: string; model: string | null; created_at: string;
  finished_at: string | null; error: string | null; details: string[]; revision: number | null;
}
export interface RecordData {
  id: string; title: string; created_at: string;
  source: { id: string; input_kind: string; filename: string | null; narrative_origin: string; content: string; sha256: string };
  latest_revision: number; selected_revision: number; confirmed_revision: number | null;
  review_status: string; trajectory: Trajectory | null; warnings: string[];
  attempts: Attempt[]; revisions: { revision: number; origin: string; created_at: string; confirmed_at: string | null }[];
  extraction_status: string;
}
export const inputLabels: Record<InputKey,string> = { goals:'研究目标',constraints:'约束条件',background:'已有信息',human_choices:'人为条件' };
export const originLabels: Record<string,string> = { source_explicit:'原文明述',inferred:'推断',user_added:'人工补充',synthetic:'模拟' };
export const narrativeLabels: Record<string,string> = { researcher_summary:'研究者总结',ai_summary:'AI 总结',synthetic_example:'模拟示例',unknown:'来源未注明' };
export const occurrenceLabels: Record<string,string> = { reported:'原稿报告已发生',planned:'计划开展',unknown:'发生情况未知' };
export const relationLabels: Record<string,string> = { precedes:'时序先后',supports:'论证依据',parallel:'明确并行' };
export const outputLabels: Record<string,string> = { scheme:'方案',hypothesis_conclusion:'假设结论',negative_finding:'否定性发现',open_question:'新问题',other:'其他产出' };
export const outputStatuses: Record<string,string> = { proposed:'提出／待验证',reported_supported:'作者报告支持',reported_refuted:'作者报告否定',unresolved:'未解决',unknown:'状态未知' };
export const actionLabels: Record<string,string> = { literature_search:'查阅文献',experiment:'实验',characterization:'表征',computation:'计算',data_analysis:'数据分析',consultation:'咨询',other:'其他动作' };
export const statusLabels: Record<string,string> = { idle:'原稿已保存',pending:'等待提取',running:'提取中',failed:'提取失败',succeeded:'已生成轨迹' };
export function dateLabel(value: string) { return new Date(value).toLocaleString('zh-CN',{ month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit' }); }
