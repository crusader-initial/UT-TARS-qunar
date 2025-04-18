/*
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */
import OpenAI, { type ClientOptions } from 'openai';
import {
  type ChatCompletionCreateParamsBase,
  type ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import { actionParser } from '@ui-tars/action-parser';

import { useContext } from './context/useContext';
import { Model, type InvokeParams, type InvokeOutput } from './types';

import { preprocessResizeImage, convertToOpenAIMessages } from './utils';
import { DEFAULT_FACTORS, MAX_PIXELS } from './constants';
import { log } from 'console';

type OpenAIChatCompletionCreateParams = Omit<ClientOptions, 'maxRetries'> &
  Pick<
    ChatCompletionCreateParamsBase,
    'model' | 'max_tokens' | 'temperature' | 'top_p'
  >;

export interface UITarsModelConfig extends OpenAIChatCompletionCreateParams {}

export class UITarsModel extends Model {
  constructor(protected readonly modelConfig: UITarsModelConfig) {
    super();
    this.modelConfig = modelConfig;
  }

  /** [widthFactor, heightFactor] */
  get factors(): [number, number] {
    return DEFAULT_FACTORS;
  }

  get modelName(): string {
    return this.modelConfig.model ?? 'unknown';
  }

  /**
   * call real LLM / VLM Model
   * @param params
   * @param options
   * @returns
   */
  protected async invokeModelProvider(
    params: {
      messages: Array<ChatCompletionMessageParam>;
    },
    options: {
      signal?: AbortSignal;
    },
  ): Promise<{
    prediction: string;
  }> {
    const { messages } = params;
    const {
      baseURL,
      apiKey,
      model,
      max_tokens = 1000,
      temperature = 0,
      top_p = 0.7,
      ...restOptions
    } = this.modelConfig;

    // 打印完整的请求参数
    // const { logger } = useContext();
    // logger?.info(
    //   '[UITarsModel Request]:',
    //   JSON.stringify({
    //     model,
    //     messages: messages.map((msg) => ({
    //       role: msg.role,
    //       content:
    //         typeof msg.content === 'string'
    //           ? msg.content
    //           : Array.isArray(msg.content)
    //             ? msg.content.map((item) =>
    //                 item.type === 'text'
    //                   ? {
    //                       type: 'text',
    //                       text: item.text,
    //                     }
    //                   : {
    //                       type: 'image_url',
    //                       image_url: { url: '...(image data truncated)' },
    //                     },
    //               )
    //             : msg.content,
    //     })),
    //     max_tokens,
    //     temperature,
    //     top_p,
    //   }),
    // );

    const openai = new OpenAI({
      ...restOptions,
      maxRetries: 0,
      baseURL,
      apiKey,
    });

    const result = await openai.chat.completions.create(
      {
        model,
        messages,
        stream: false,
        seed: null,
        stop: null,
        frequency_penalty: null,
        presence_penalty: null,
        // custom options
        max_tokens,
        temperature,
        top_p,
      },
      options,
    );

    return {
      prediction: result.choices?.[0]?.message?.content ?? '',
    };
  }

  async invoke(params: InvokeParams): Promise<InvokeOutput> {
    const { conversations, images, screenContext, scaleFactor } = params;
    const { logger, signal } = useContext();

    // const compressedImages = await Promise.all(
    //   images.map((image) => preprocessResizeImage(image, MAX_PIXELS)),
    // );

    const messages = convertToOpenAIMessages({
      conversations,
      images: images,
    });

    const startTime = Date.now();
    const result = await this.invokeModelProvider(
      {
        messages,
      },
      {
        signal,
      },
    )
      .catch((e) => {
        logger?.error('[UITarsModel] error', e);
        throw e;
      })
      .finally(() => {
        logger?.info(`[UITarsModel cost]: ${Date.now() - startTime}ms`);
      });

    if (!result.prediction) {
      const err = new Error();
      err.name = 'vlm response error';
      err.stack = JSON.stringify(result) ?? 'no message';
      logger?.error(err);
      throw err;
    }

    const { prediction } = result;

    try {
      const { parsed: parsedPredictions } = await actionParser({
        prediction,
        factor: this.factors,
        screenContext,
        scaleFactor,
      });
      return {
        prediction,
        parsedPredictions,
      };
    } catch (error) {
      logger?.error('[UITarsModel] error', error);
      return {
        prediction,
        parsedPredictions: [],
      };
    }
  }

  /**
   * 纯文本调用大模型，不需要图片输入
   * @param systemPrompt 系统提示词
   * @param userMessage 用户消息
   * @returns 模型输出结果
   */
  async invokeTextOnly(
    systemPrompt: string,
    userMessage: string,
  ): Promise<string> {
    const { logger, signal } = useContext();

    // 构建纯文本消息
    const messages: Array<ChatCompletionMessageParam> = [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: userMessage,
      },
    ];

    const startTime = Date.now();
    try {
      const result = await this.invokeModelProvider({ messages }, { signal });

      logger?.info(`[UITarsModel TextOnly cost]: ${Date.now() - startTime}ms`);
      return result.prediction;
    } catch (e) {
      logger?.error('[UITarsModel TextOnly] error', e);
      throw e;
    }
  }
}
