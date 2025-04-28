/**
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useToast } from '@chakra-ui/react';
import { useEffect } from 'react';
import { Conversation } from '@ui-tars/shared/types';

import { useStore } from '@renderer/hooks/useStore';

import { usePermissions } from './usePermissions';
import { useSetting } from './useSetting';
import { api } from '@renderer/api';

export const useRunAgent = () => {
  // const dispatch = useDispatch();
  const toast = useToast();
  const { settings } = useSetting();
  const { messages } = useStore();
  const { ensurePermissions } = usePermissions();

  console.log('messages', messages);

  // 添加自动发送 #Workspace 指令的效果
  useEffect(() => {
    // 检查是否是首次加载且没有消息
    if (messages.length === 0) {
      // 自动发送 #Workspace 指令
      const workspaceCommand = '查询北京5月20日汉庭酒店(北京王府井店)';
      console.log('自动发送指令:', workspaceCommand);

      const initialMessages: Conversation[] = [
        {
          from: 'human',
          value: workspaceCommand,
          timing: { start: Date.now(), end: Date.now(), cost: 0 },
        },
      ];

      // 设置指令并运行
      Promise.all([
        api.setInstructions({ instructions: workspaceCommand }),
        api.setMessages({ messages: initialMessages }),
      ])
        .then(() => {
          api.runAgent();
        })
        .catch((error) => {
          console.error('自动发送 #Workspace 指令失败:', error);
        });
    }
  }, [messages.length]); // 依赖于消息数量，确保只在首次加载时执行

  const run = async (value: string, callback: () => void = () => {}) => {
    if (
      !ensurePermissions?.accessibility ||
      !ensurePermissions?.screenCapture
    ) {
      const permissionsText = [
        !ensurePermissions?.screenCapture ? 'screenCapture' : '',
        !ensurePermissions?.accessibility ? 'Accessibility' : '',
      ]
        .filter(Boolean)
        .join(' and ');
      toast({
        title: `Please grant the required permissions(${permissionsText})`,
        position: 'top',
        status: 'warning',
        duration: 2000,
        isClosable: true,
      });
      return;
    }

    // check settings whether empty
    const settingReady = settings?.vlmBaseUrl && settings?.vlmModelName;

    if (!settingReady) {
      toast({
        title: 'Please set up the model configuration first',
        position: 'top',
        status: 'warning',
        duration: 2000,
        isClosable: true,
        onCloseComplete: async () => {
          await api.openSettingsWindow();
        },
      });
      return;
    }

    const initialMessages: Conversation[] = [
      {
        from: 'human',
        value,
        timing: { start: Date.now(), end: Date.now(), cost: 0 },
      },
    ];
    console.log('initialMessages', initialMessages);

    await Promise.all([
      api.setInstructions({ instructions: value }),
      api.setMessages({ messages: [...messages, ...initialMessages] }),
    ]);
    await api.setInstructions({
      instructions: '查询北京5月20日汉庭酒店(北京王府井店)',
    });
    api.runAgent();

    callback();
  };

  return { run };
};
