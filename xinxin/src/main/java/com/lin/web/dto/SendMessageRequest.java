package com.lin.web.dto;

import lombok.Data;

/**
 * 发送钉钉消息请求实体
 */
@Data
public class SendMessageRequest {
    
    /**
     * 消息内容
     */
    private String msg;
    
    /**
     * 消息key
     */
    private String msgKey;
    
    /**
     * 钉钉应用id
     */
    private String agentId;
    
    /**
     * 钉钉用户id
     */
    private Long userId;
} 