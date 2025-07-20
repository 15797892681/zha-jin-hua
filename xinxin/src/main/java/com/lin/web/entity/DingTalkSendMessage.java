package com.lin.web.entity;

import com.fasterxml.jackson.annotation.JsonFormat;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Date;

/**
 * 钉钉发送消息实体类
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class DingTalkSendMessage {
    
    /**
     * 主键id
     */
    private Long id;
    
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
    
    /**
     * 创建时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date createdAt;
    
    /**
     * 更新时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date updatedAt;
    
    /**
     * 带参数的构造函数（不包含id和时间字段）
     */
    public DingTalkSendMessage(String msg, String msgKey, String agentId, Long userId) {
        this.msg = msg;
        this.msgKey = msgKey;
        this.agentId = agentId;
        this.userId = userId;
    }
} 