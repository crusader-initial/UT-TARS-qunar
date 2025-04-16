/**
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */
import { GUIAgentData } from '@ui-tars/shared/types';

import { LocalStore, PresetSource } from './validate';
import { ConversationWithSoM } from '@main/shared/types';

export type NextAction =
  | { type: 'key'; text: string }
  | { type: 'type'; text: string }
  | { type: 'mouse_move'; x: number; y: number }
  | { type: 'left_click' }
  | { type: 'left_click_drag'; x: number; y: number }
  | { type: 'right_click' }
  | { type: 'middle_click' }
  | { type: 'double_click' }
  | { type: 'screenshot' }
  | { type: 'cursor_position' }
  | { type: 'finish' }
  | { type: 'error'; message: string };

export type AppState = {
  theme: 'dark' | 'light';
  ensurePermissions: { screenCapture?: boolean; accessibility?: boolean };
  instructions: string | null;
  restUserData: Omit<GUIAgentData, 'status' | 'conversations'> | null;
  status: GUIAgentData['status'];
  errorMsg: string | null;
  messages: ConversationWithSoM[];
  abortController: AbortController | null;
  thinking: boolean;
  planSteps?: string[]; // 规划的任务步骤列表
  currentPlanStep?: number; // 当前执行的步骤索引
  // 添加任务报告字段
  taskReport?: {
    title: string;
    summary: string;
    details: Array<{
      app_name: string;
      price: string;
      additional_info: string;
    }>;
    comparison: string;
    recommendation: string;
  };
};

export enum VlmProvider {
  // Ollama = 'ollama',
  Huggingface = 'Hugging Face',
  vLLM = 'vLLM',
}

// 添加 Operator 类型枚举
export enum OperatorType {
  NutJS = 'NutJS',
  ADB = 'ADB',
}

export type { PresetSource, LocalStore };
