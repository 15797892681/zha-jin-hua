package com.lin.web.service.impl;

import com.lin.web.entity.DingTalkSendMessage;
import com.lin.web.mapper.DingTalkSendMessageMapper;
import com.lin.web.service.DingTalkSendMessageService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * 钉钉发送消息Service实现类
 */
@Service
@Slf4j
public class DingTalkSendMessageServiceImpl implements DingTalkSendMessageService {
    
    @Autowired
    private DingTalkSendMessageMapper dingTalkSendMessageMapper;
    
    @Override
    public DingTalkSendMessage save(DingTalkSendMessage message) {
        if (message == null) {
            throw new IllegalArgumentException("消息对象不能为空");
        }

        try {
            int result = dingTalkSendMessageMapper.insert(message);

            if (result > 0) {
                return message;
            }
        } catch (Exception e) {
            log.error("保存消息时发生错误: " + e);
        }
        return message;
    }
    
    @Override
    @Transactional(readOnly = true)
    public DingTalkSendMessage findById(Long id) {
        if (id == null) {
            throw new IllegalArgumentException("消息ID不能为空");
        }
        return dingTalkSendMessageMapper.selectById(id);
    }
    
    @Override
    @Transactional(readOnly = true)
    public List<DingTalkSendMessage> findByUserId(Long userId) {
        if (userId == null) {
            throw new IllegalArgumentException("用户ID不能为空");
        }
        return dingTalkSendMessageMapper.selectByUserId(userId);
    }
    
    @Override
    @Transactional(readOnly = true)
    public List<DingTalkSendMessage> findByAgentIdAndUserId(String agentId, Long userId) {
        if (agentId == null || userId == null) {
            throw new IllegalArgumentException("应用ID和用户ID不能为空");
        }
        return dingTalkSendMessageMapper.selectByAgentIdAndUserId(agentId, userId);
    }
    
    @Override
    @Transactional(readOnly = true)
    public DingTalkSendMessage findByMsgKey(String msgKey) {
        if (msgKey == null || msgKey.trim().isEmpty()) {
            throw new IllegalArgumentException("消息key不能为空");
        }
        return dingTalkSendMessageMapper.selectByMsgKey(msgKey);
    }
    
    @Override
    @Transactional(readOnly = true)
    public List<DingTalkSendMessage> findAll() {
        return dingTalkSendMessageMapper.selectAll();
    }
    
    @Override
    public DingTalkSendMessage update(DingTalkSendMessage message) {
        if (message == null || message.getId() == null) {
            throw new IllegalArgumentException("消息对象和ID不能为空");
        }
        
        // 检查消息是否存在
        DingTalkSendMessage existingMessage = dingTalkSendMessageMapper.selectById(message.getId());
        if (existingMessage == null) {
            throw new RuntimeException("消息不存在，ID: " + message.getId());
        }
        
        int result = dingTalkSendMessageMapper.update(message);
        if (result > 0) {
            return dingTalkSendMessageMapper.selectById(message.getId());
        }
        throw new RuntimeException("更新消息失败");
    }
    
    @Override
    public boolean deleteById(Long id) {
        if (id == null) {
            throw new IllegalArgumentException("消息ID不能为空");
        }
        
        int result = dingTalkSendMessageMapper.deleteById(id);
        return result > 0;
    }
    
    @Override
    public int deleteByUserId(Long userId) {
        if (userId == null) {
            throw new IllegalArgumentException("用户ID不能为空");
        }
        
        return dingTalkSendMessageMapper.deleteByUserId(userId);
    }
    
    @Override
    public boolean sendMessage(String msg, String msgKey, String agentId, Long userId) {
        if (msg == null || msg.trim().isEmpty()) {
            throw new IllegalArgumentException("消息内容不能为空");
        }
        if (msgKey == null || msgKey.trim().isEmpty()) {
            throw new IllegalArgumentException("消息key不能为空");
        }
        if (agentId == null || agentId.trim().isEmpty()) {
            throw new IllegalArgumentException("应用ID不能为空");
        }
        if (userId == null) {
            throw new IllegalArgumentException("用户ID不能为空");
        }
        
        try {
            // 创建消息对象
            DingTalkSendMessage message = new DingTalkSendMessage(msg, msgKey, agentId, userId);
            
            // 保存到数据库
            save(message);
            
            // TODO: 这里可以添加实际的钉钉API调用逻辑
            // 例如调用钉钉的发送消息API
            
            return true;
        } catch (Exception e) {
            // 记录日志
            System.err.println("发送钉钉消息失败: " + e.getMessage());
            return false;
        }
    }
} 