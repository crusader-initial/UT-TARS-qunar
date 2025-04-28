/*
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */
import { runAgent } from '../runAgent';
import { StatusEnum } from '@ui-tars/shared/types';
import { UTIOService } from '@main/services/utio';
import { hideWindowBlock } from '@main/window/index';
import { UITarsModel } from '@ui-tars/sdk/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 模拟依赖
vi.mock('@main/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@main/window/index', () => ({
  hideWindowBlock: vi.fn((fn) => fn()),
}));

vi.mock('@main/services/utio', () => ({
  UTIOService: {
    getInstance: vi.fn(() => ({
      sendInstruction: vi.fn(),
    })),
  },
}));

vi.mock('@ui-tars/sdk/core', () => ({
  UITarsModel: vi.fn().mockImplementation(() => ({
    invokeTextOnly: vi.fn().mockResolvedValue('模型响应'),
  })),
}));

vi.mock('@main/store/setting', () => ({
  SettingStore: {
    getStore: vi.fn(() => ({
      vlmBaseUrl: 'https://openrouter.ai/api/v1/',
      vlmApiKey:
        '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',
      vlmModelName: 'qwen/qwen2.5-vl-72b-instruct',
      language: 'zh',
      operatorType: 'ADB',
      androidDeviceId: '47.93.20.54:186',
    })),
  },
}));

// 模拟 GUIAgent
vi.mock('@ui-tars/sdk', () => ({
  GUIAgent: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue(undefined),
    runWithPlan: vi.fn().mockResolvedValue(undefined),
  })),
  StatusEnum,
}));

describe('runAgent', () => {
  let setState;
  let getState;

  beforeEach(() => {
    // 重置模拟函数
    vi.clearAllMocks();

    // 设置状态管理函数
    setState = vi.fn();
    getState = vi.fn(() => ({
      instructions: '在去哪儿旅行中搜索北京的如家酒店',
      abortController: new AbortController(),
      messages: [],
    }));
  });

  it('应该正确调用 runAgent 方法', async () => {
    // 执行测试
    await runAgent(setState, getState);

    // 验证调用
    expect(hideWindowBlock).toHaveBeenCalled();
    expect(UTIOService.getInstance().sendInstruction).toHaveBeenCalledWith(
      '在去哪儿旅行中搜索北京的如家酒店',
    );
    expect(UITarsModel).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://openrouter.ai/api/v1/',
        apiKey:
          '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',
        model: 'anthropic/claude-3.7-sonnet',
      }),
    );
  });
});
