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
import {
  getInstructionSysPrompt,
  getTaskPlanningPrompt,
  getReportGenerationPrompt,
} from '../agent/prompts';
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
import { UITarsModel } from '@ui-tars/sdk/core';
import { commandWithTimeout } from '@ui-tars/operator-adb';

// 规划任务的函数
async function planTasks(
  instructions: string,
  preModel: UITarsModel,
  language: 'zh' | 'en' = 'en',
): Promise<string[]> {
  logger.info('[planTasks] 开始规划任务');

  try {
    let taskPlanningPrompt = getTaskPlanningPrompt(language);

    if (preModel && typeof preModel.invokeTextOnly === 'function') {
      // 使用SDK调用模型
      const response = await preModel.invokeTextOnly(
        taskPlanningPrompt,
        `请将以下任务分解为具体步骤：${instructions}`,
      );
      logger.info('[planTasks] 规划 API 响应:', response);

      // 处理返回的结果
      let planSteps: string[] = [];

      // 预处理响应，移除可能的Markdown代码块标记
      let processedResponse = response;
      // 检查是否是Markdown代码块格式（以```开头）
      if (response.trim().startsWith('```')) {
        // 移除开头的```和可能的语言标识
        processedResponse = response.replace(/^```(?:json)?\s*\n?/, '');
        // 移除结尾的```
        processedResponse = processedResponse.replace(/\n?```\s*$/, '');
        logger.info('[planTasks] 检测到Markdown格式，已处理为纯文本');
      }

      try {
        // 尝试解析JSON响应
        const parsedResponse = JSON.parse(processedResponse);
        planSteps = parsedResponse.steps || [];
        logger.info('[planTasks] 成功解析JSON响应');
      } catch (parseError) {
        // 如果不是有效的JSON，尝试从文本中提取步骤
        logger.warn(
          '[planTasks] 解析JSON失败，尝试从文本提取步骤:',
          parseError,
        );
        // 简单的文本处理逻辑，根据实际返回格式可能需要调整
        planSteps = processedResponse
          .split('\n')
          .filter(
            (line) =>
              line.trim().startsWith('Step') || line.trim().match(/^\d+\./),
          )
          .map((line) => line.trim());

        // 如果没有找到步骤，尝试查找JSON格式的部分
        if (planSteps.length === 0) {
          const jsonMatch = processedResponse.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try {
              const jsonPart = jsonMatch[0];
              logger.info('[planTasks] 尝试从文本中提取JSON部分');
              const extractedJson = JSON.parse(jsonPart);
              planSteps = extractedJson.steps || [];
            } catch (jsonExtractError) {
              logger.warn('[planTasks] 从文本提取JSON失败:', jsonExtractError);
            }
          }
        }
      }

      logger.info('[planTasks] 规划完成，步骤数:', planSteps.length);
      return planSteps;
    } else {
      logger.warn('[Text-only model] Method not available');
      return [instructions];
    }
  } catch (error) {
    logger.error('[planTasks] 规划失败:', error);
    // 如果规划失败，返回原始指令作为唯一步骤
    return [instructions];
  }
}

async function generateTaskReport(
  instructions: string,
  messages: ConversationWithSoM[],
  genReportModel: UITarsModel,
  language: 'zh' | 'en' = 'en',
): Promise<any> {
  logger.info('[generateTaskReport] 开始生成任务报告');

  try {
    // 提取所有对话内容和截图信息
    const conversationHistory = messages
      .map((msg) => {
        if (msg.from === 'gpt' && msg.value) {
          return `AI: ${msg.value}`;
        } else if (msg.from === 'human' && msg.value !== '[IMAGE]') {
          return `User: ${msg.value}`;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');

    // 获取报告生成提示
    const reportPrompt = getReportGenerationPrompt(language);

    if (genReportModel && typeof genReportModel.invokeTextOnly === 'function') {
      // 构建报告请求
      const reportRequest = `
        原始任务: ${instructions}

        对话历史:
        ${conversationHistory}

        请根据以上信息生成一份任务执行报告，特别关注价格比较结果。
      `;

      // 调用模型生成报告
      const response = await genReportModel.invokeTextOnly(
        reportPrompt,
        reportRequest,
      );

      logger.info('[generateTaskReport] 报告生成响应:', response);

      // 预处理响应，移除可能的Markdown代码块标记
      let processedResponse = response;
      // 检查是否是Markdown代码块格式（以```开头）
      if (response.trim().startsWith('```')) {
        // 移除开头的```和可能的语言标识
        processedResponse = response.replace(/^```(?:json)?\s*\n?/, '');
        // 移除结尾的```
        processedResponse = processedResponse.replace(/\n?```\s*$/, '');
        logger.info('[generateTaskReport] 检测到Markdown格式，已处理为纯文本');
      }

      // 尝试解析JSON响应
      try {
        const parsedReport = JSON.parse(processedResponse);
        return parsedReport;
      } catch (parseError) {
        logger.warn(
          '[generateTaskReport] 解析JSON失败，返回原始响应:',
          parseError,
        );

        // 尝试查找JSON格式的部分
        const jsonMatch = processedResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const jsonPart = jsonMatch[0];
            logger.info('[generateTaskReport] 尝试从文本中提取JSON部分');
            return JSON.parse(jsonPart);
          } catch (jsonExtractError) {
            logger.warn(
              '[generateTaskReport] 从文本提取JSON失败:',
              jsonExtractError,
            );
          }
        }
        return {
          title: '任务执行报告',
          summary: response,
          details: [],
          comparison: '',
          recommendation: '',
        };
      }
    } else {
      logger.warn('[generateTaskReport] Text-only model 方法不可用');
      return {
        title: '任务执行报告',
        summary: '无法生成详细报告，模型功能不可用',
        details: [],
        comparison: '',
        recommendation: '',
      };
    }
  } catch (error) {
    logger.error('[generateTaskReport] 报告生成失败:', error);
    return {
      title: '任务执行报告',
      summary: '报告生成过程中发生错误',
      details: [],
      comparison: '',
      recommendation: '',
    };
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
      model: settings.vlmModelName,
    };

    let instructionSysPrompt = getInstructionSysPrompt(language);
    // 尝试获取模型实例并调用纯文本方法
    // 构建模型实例
    const preModel = new UITarsModel(preModelConfig);
    let response: any = '';
    try {
      if (preModel && typeof preModel.invokeTextOnly === 'function') {
        // 正确传递两个独立参数
        response = await preModel.invokeTextOnly(
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

    // 先进行任务规划
    const planSteps = await planTasks(response, preModel, language);

    // 更新状态，显示规划结果
    setState({
      ...getState(),
      planSteps,
      currentPlanStep: 0,
    });

    const platformPackage = {
      去哪儿旅行: 'com.Qunar',
      携程旅行: 'ctrip.android.view',
      美团: 'com.sankuai.meituan',
      同程旅行: 'com.tongcheng.android ',
      飞猪旅行: 'com.taobao.trip',
    };
    // 声明比价平台数组
    const comparisonPlatforms = ['去哪儿旅行', '携程旅行', '同程旅行'];
    for (const platform of comparisonPlatforms) {
      const package_name = platformPackage[platform];
      logger.info(`[AdbOperator] Opening app: ${package_name}`);
      await commandWithTimeout(
        `adb -s ${deviceId} shell monkey -p ${package_name} -c android.intent.category.LAUNCHER 1`,
      );
      // 如果有规划步骤，则逐步执行
      if (planSteps.length > 0) {
        logger.info(
          `[runAgent] 开始执行规划任务，共 ${planSteps.length} 个步骤`,
        );
        const input = `userInstructions: ${response}, planStep: ${planSteps}`;
        await guiAgent.run(input);
        //   for (let i = 0; i < planSteps.length; i++) {
        //     if (abortController?.signal?.aborted) {
        //       logger.info('[runAgent] 任务被中止');
        //       break;
        //     }
        //     const step = planSteps[i];
        //     logger.info(
        //       `[runAgent] 执行步骤 ${i + 1}/${planSteps.length}: ${step}`,
        //     );
        //     // 更新当前执行的步骤
        //     setState({
        //       ...getState(),
        //       currentPlanStep: i,
        //     });
        //     // 执行当前步骤
        //     await guiAgent.runWithPlan(response, step, planSteps).catch((e) => {
        //       logger.error(`[runAgent] 步骤 ${i + 1} 执行失败:`, e);
        //       // 继续执行下一步，不中断整个流程
        //     });
        //   }
        // 任务完成后生成报告
        const genReportModelConfig = {
          baseURL: settings.vlmBaseUrl,
          apiKey: settings.vlmApiKey,
          model: 'openai/gpt-4.1-mini',
        };
        const genReportModel = new UITarsModel(genReportModelConfig);
        const taskReport = await generateTaskReport(
          instructions,
          getState().messages,
          genReportModel,
          language,
        );

        // 更新状态，添加报告
        setState({
          ...getState(),
          taskReport,
          status: StatusEnum.END,
        });
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
    }
  }).catch((e) => {
    logger.error('[runAgent error hideWindowBlock]', settings, e);
  });
};
