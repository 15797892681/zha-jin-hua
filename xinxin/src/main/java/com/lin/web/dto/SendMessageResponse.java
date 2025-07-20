package com.lin.web.dto;

import lombok.Data;

/**
 * 发送钉钉消息响应实体
 */
@Data
public class SendMessageResponse {
    
    /**
     * 是否发送成功
     */
    private boolean success;
    
    /**
     * 消息ID
     */
    private Long messageId;
    
    /**
     * 发送时间
     */
    private String sendTime;
} 