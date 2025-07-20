package com.lin.web.service;

import com.lin.web.entity.DingTalkSendMessage;

import java.util.List;

/**
 * 钉钉发送消息Service接口
 */
public interface DingTalkSendMessageService {
    
    /**
     * 保存钉钉发送消息
     * @param message 消息对象
     * @return 保存后的消息对象
     */
    DingTalkSendMessage save(DingTalkSendMessage message);
    
    /**
     * 根据ID查询消息
     * @param id 消息ID
     * @return 消息对象
     */
    DingTalkSendMessage findById(Long id);
    
    /**
     * 根据用户ID查询消息列表
     * @param userId 用户ID
     * @return 消息列表
     */
    List<DingTalkSendMessage> findByUserId(Long userId);
    
    /**
     * 根据应用ID和用户ID查询消息列表
     * @param agentId 应用ID
     * @param userId 用户ID
     * @return 消息列表
     */
    List<DingTalkSendMessage> findByAgentIdAndUserId(String agentId, Long userId);
    
    /**
     * 根据消息key查询消息
     * @param msgKey 消息key
     * @return 消息对象
     */
    DingTalkSendMessage findByMsgKey(String msgKey);
    
    /**
     * 查询所有消息
     * @return 消息列表
     */
    List<DingTalkSendMessage> findAll();
    
    /**
     * 更新消息
     * @param message 消息对象
     * @return 更新后的消息对象
     */
    DingTalkSendMessage update(DingTalkSendMessage message);
    
    /**
     * 根据ID删除消息
     * @param id 消息ID
     * @return 是否删除成功
     */
    boolean deleteById(Long id);
    
    /**
     * 根据用户ID删除消息
     * @param userId 用户ID
     * @return 删除的消息数量
     */
    int deleteByUserId(Long userId);
    
    /**
     * 发送钉钉消息
     * @param msg 消息内容
     * @param msgKey 消息key
     * @param agentId 应用ID
     * @param userId 用户ID
     * @return 发送结果
     */
    boolean sendMessage(String msg, String msgKey, String agentId, Long userId);
} 