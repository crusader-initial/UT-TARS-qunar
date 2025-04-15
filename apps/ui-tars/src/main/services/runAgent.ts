/**
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'assert';

import { logger } from '@main/logger';
import { hideWindowBlock } from '@main/window/index';
import { StatusEnum } from '@ui-tars/shared/types';
import { type ConversationWithSoM } from '@main/shared/types';
import { GUIAgent, type GUIAgentConfig } from '@ui-tars/sdk';
import { markClickPosition } from '@main/utils/image';
import { UTIOService } from '@main/services/utio';
import { NutJSElectronOperator } from '../agent/operator';
import { AdbElectronOperator } from '../agent/operator';
import { getSystemPrompt } from '../agent/prompts';
import { getInstructionSysPrompt } from '../agent/prompts';
import {
  closeScreenMarker,
  hidePauseButton,
  hideScreenWaterFlow,
  showPauseButton,
  showPredictionMarker,
  showScreenWaterFlow,
} from '@main/window/ScreenMarker';
import { SettingStore } from '@main/store/setting';
import { AppState, OperatorType } from '@main/store/types';
import { Model } from 'node_modules/@ui-tars/sdk/dist/types';
import { UITarsModel } from '@ui-tars/sdk/core';

// 新增：规划任务的函数
async function planTasks(
  instructions: string,
  modelConfig: { baseURL: string; apiKey: string; model: string },
  language: string = 'en',
): Promise<string[]> {
  logger.info('[planTasks] 开始规划任务');

  try {
    // 使用 fetch 调用模型 API 进行规划
    const response = await fetch(modelConfig.baseURL + 'chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${modelConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: modelConfig.model,
        messages: [
          {
            role: 'system',
            content: `你是一个任务规划助手。请将用户的指令分解为一系列具体的步骤，每个步骤应该是一个简单明确的操作。
            输出格式应为 JSON 数组，每个元素是一个步骤描述字符串。
            语言: ${language}`,
          },
          {
            role: 'user',
            content: `请将以下任务分解为具体步骤：${instructions}`,
          },
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      throw new Error(`规划 API 调用失败: ${response.statusText}`);
    }

    const data = await response.json();
    logger.info('[planTasks] 规划 API 响应:', data);
    const planSteps = JSON.parse(data.choices[0].message.content).steps || [];

    logger.info('[planTasks] 规划完成，步骤数:', planSteps.length);
    return planSteps;
  } catch (error) {
    logger.error('[planTasks] 规划失败:', error);
    // 如果规划失败，返回原始指令作为唯一步骤
    return [instructions];
  }
}

export const runAgent = async (
  setState: (state: AppState) => void,
  getState: () => AppState,
) => {
  logger.info('runAgent');
  const settings = SettingStore.getStore();
  const { instructions, abortController } = getState();
  assert(instructions, 'instructions is required');

  const language = settings.language ?? 'en';

  showPauseButton();
  showScreenWaterFlow();

  // 从设置中获取 deviceId，如果没有则设为 null
  let deviceId = settings.androidDeviceId || '';

  const handleData: GUIAgentConfig<
    NutJSElectronOperator | AdbElectronOperator
  >['onData'] = async ({ data }) => {
    const lastConv = getState().messages[getState().messages.length - 1];
    const { status, conversations, ...restUserData } = data;
    logger.info('[status]', status, conversations.length);

    // add SoM to conversations
    const conversationsWithSoM: ConversationWithSoM[] = await Promise.all(
      conversations.map(async (conv) => {
        const { screenshotContext, predictionParsed } = conv;
        if (
          lastConv?.screenshotBase64 &&
          screenshotContext?.size &&
          predictionParsed
        ) {
          const screenshotBase64WithElementMarker = await markClickPosition({
            screenshotContext,
            base64: lastConv?.screenshotBase64,
            parsed: predictionParsed,
          }).catch((e) => {
            logger.error('[markClickPosition error]:', e);
            return '';
          });
          return {
            ...conv,
            screenshotBase64WithElementMarker,
          };
        }
        return conv;
      }),
    ).catch((e) => {
      logger.error('[conversationsWithSoM error]:', e);
      return conversations;
    });

    const {
      screenshotBase64,
      predictionParsed,
      screenshotContext,
      screenshotBase64WithElementMarker,
      ...rest
    } = conversationsWithSoM?.[conversationsWithSoM.length - 1] || {};
    logger.info(
      '======data======\n',
      predictionParsed,
      screenshotContext,
      rest,
      status,
      '\n========',
    );

    if (
      predictionParsed?.length &&
      screenshotContext?.size &&
      !abortController?.signal?.aborted
    ) {
      showPredictionMarker(predictionParsed, screenshotContext);
    }

    setState({
      ...getState(),
      status,
      restUserData,
      messages: [...(getState().messages || []), ...conversationsWithSoM],
    });
  };

  // 如果没有预先配置的设备 ID，可以尝试自动获取
  if (!deviceId && settings.operatorType === OperatorType.ADB) {
    try {
      // 从 AdbOperator 导入 getAndroidDeviceId 函数
      const { getAndroidDeviceId } = await import('@ui-tars/operator-adb');
      deviceId = await getAndroidDeviceId();

      if (!deviceId) {
        logger.error('[runAgent] No Android device found');
        setState({
          ...getState(),
          status: StatusEnum.ERROR,
          errorMsg: '未找到 Android 设备，请确保设备已连接并启用 USB 调试',
        });
        return;
      }
    } catch (error) {
      logger.error('[runAgent] Failed to get Android device ID', error);
      setState({
        ...getState(),
        status: StatusEnum.ERROR,
        errorMsg: '获取 Android 设备 ID 失败',
      });
      return;
    }
  }

  const guiAgent = new GUIAgent({
    model: {
      baseURL: settings.vlmBaseUrl,
      apiKey: settings.vlmApiKey,
      model: settings.vlmModelName,
    },
    systemPrompt: getSystemPrompt(language),
    logger,
    signal: abortController?.signal,
    // 根据设置选择使用哪个 operator
    operator:
      settings.operatorType === OperatorType.ADB
        ? new AdbElectronOperator(deviceId)
        : new NutJSElectronOperator(),
    onData: handleData,
    onError: ({ error }) => {
      logger.error('[runAgent error]', settings, error);
    },
    retry: {
      model: {
        maxRetries: 3,
      },
      screenshot: {
        maxRetries: 5,
      },
      execute: {
        maxRetries: 1,
      },
    },
  });

  await hideWindowBlock(async () => {
    await UTIOService.getInstance().sendInstruction(instructions);

    const preModelConfig = {
      baseURL: settings.vlmBaseUrl,
      apiKey: settings.vlmApiKey,
      model: 'anthropic/claude-3.7-sonnet',
    };

    let instructionSysPrompt = getInstructionSysPrompt(language);
    // 尝试获取模型实例并调用纯文本方法
    try {
      // 构建模型实例
      const preModel = new UITarsModel(preModelConfig);

      if (preModel && typeof preModel.invokeTextOnly === 'function') {
        // 正确传递两个独立参数
        const response = await preModel.invokeTextOnly(
          instructionSysPrompt,
          instructions,
        );
        logger.info('[Text-only model response]', response);
      } else {
        logger.warn('[Text-only model] Method not available');
      }
    } catch (error) {
      logger.error('[Text-only model error]', error);
    }

    // 新增：先进行任务规划

    const planSteps = await planTasks(instructions, preModelConfig, language);

    // 更新状态，显示规划结果
    setState({
      ...getState(),
      planSteps,
      currentPlanStep: 0,
    });
    // 如果有规划步骤，则逐步执行
    if (planSteps.length > 0) {
      logger.info(`[runAgent] 开始执行规划任务，共 ${planSteps.length} 个步骤`);

      for (let i = 0; i < planSteps.length; i++) {
        if (abortController?.signal?.aborted) {
          logger.info('[runAgent] 任务被中止');
          break;
        }

        const step = planSteps[i];
        logger.info(
          `[runAgent] 执行步骤 ${i + 1}/${planSteps.length}: ${step}`,
        );

        // 更新当前执行的步骤
        setState({
          ...getState(),
          currentPlanStep: i,
        });

        // 执行当前步骤
        await guiAgent.run(step).catch((e) => {
          logger.error(`[runAgent] 步骤 ${i + 1} 执行失败:`, e);
          // 继续执行下一步，不中断整个流程
        });
      }
    } else {
      // 如果没有规划步骤，直接执行原始指令
      await guiAgent
        .run(instructions)
        .catch((e) => {
          logger.error('[runAgentLoop error]', e);
          setState({
            ...getState(),
            status: StatusEnum.ERROR,
            errorMsg: e.message,
          });
        })
        .finally(() => {
          closeScreenMarker();
          hidePauseButton();
          hideScreenWaterFlow();
        });
    }
  }).catch((e) => {
    logger.error('[runAgent error hideWindowBlock]', settings, e);
  });
};
