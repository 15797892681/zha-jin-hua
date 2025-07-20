package com.lin.web.dto;

import lombok.Data;

/**
 * 删除操作响应实体
 */
@Data
public class DeleteResponse {
    
    /**
     * 是否删除成功
     */
    private boolean success;
    
    /**
     * 删除的记录数
     */
    private Integer deletedCount;
    
    /**
     * 删除的消息ID列表
     */
    private String message;
} 