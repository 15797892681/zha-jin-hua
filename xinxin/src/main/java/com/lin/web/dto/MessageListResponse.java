package com.lin.web.dto;

import com.lin.web.entity.DingTalkSendMessage;
import lombok.Data;

import java.util.List;

/**
 * 消息列表响应实体
 */
@Data
public class MessageListResponse {
    
    /**
     * 消息列表
     */
    private List<DingTalkSendMessage> messages;
    
    /**
     * 消息总数
     */
    private Integer totalCount;
    
    /**
     * 当前页数
     */
    private Integer currentPage;
    
    /**
     * 每页大小
     */
    private Integer pageSize;
} 