package com.lin.web.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Date;

/**
 * 钉钉消息DTO
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class DingTalkMessageDTO {
    
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
    private Date createdAt;
    
    /**
     * 更新时间
     */
    private Date updatedAt;
    
    /**
     * 带参数的构造函数（不包含id和时间字段）
     */
    public DingTalkMessageDTO(String msg, String msgKey, String agentId, Long userId) {
        this.msg = msg;
        this.msgKey = msgKey;
        this.agentId = agentId;
        this.userId = userId;
    }
} 