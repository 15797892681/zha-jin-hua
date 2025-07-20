package com.lin.web.controller;

import com.lin.web.common.Result;
import com.lin.web.dto.DeleteResponse;
import com.lin.web.dto.MessageListResponse;
import com.lin.web.dto.SendMessageRequest;
import com.lin.web.dto.SendMessageResponse;
import com.lin.web.entity.DingTalkSendMessage;
import com.lin.web.service.DingTalkSendMessageService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;

/**
 * 钉钉发送消息Controller
 */
@RestController
@RequestMapping("/api/dingtalk/message")
public class DingTalkSendMessageController {
    
    @Autowired
    private DingTalkSendMessageService dingTalkSendMessageService;
    
    /**
     * 发送钉钉消息
     */
    @PostMapping("/send")
    public Result<SendMessageResponse> sendMessage(@RequestBody SendMessageRequest request) {
        try {
            boolean result = dingTalkSendMessageService.sendMessage(
                request.getMsg(), 
                request.getMsgKey(), 
                request.getAgentId(), 
                request.getUserId()
            );
            
            if (result) {
                SendMessageResponse response = new SendMessageResponse();
                response.setSuccess(true);
                response.setMessageId(System.currentTimeMillis()); // 临时使用时间戳作为消息ID
                response.setSendTime(new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new Date()));
                
                return Result.success("消息发送成功", response);
            } else {
                return Result.error("消息发送失败");
            }
        } catch (Exception e) {
            return Result.error("发送消息时发生错误: " + e.getMessage());
        }
    }
    
    /**
     * 保存消息
     */
    @PostMapping("/save")
    public Result<DingTalkSendMessage> saveMessage(@RequestBody DingTalkSendMessage message) {
        try {
            DingTalkSendMessage savedMessage = dingTalkSendMessageService.save(message);
            return Result.success("消息保存成功", savedMessage);
        } catch (Exception e) {
            return Result.error("保存消息失败: " + e.getMessage());
        }
    }
    
    /**
     * 根据ID查询消息
     */
    @GetMapping("/{id}")
    public Result<DingTalkSendMessage> getMessageById(@PathVariable Long id) {
        try {
            DingTalkSendMessage message = dingTalkSendMessageService.findById(id);
            if (message != null) {
                return Result.success(message);
            } else {
                return Result.error("消息不存在");
            }
        } catch (Exception e) {
            return Result.error("查询消息失败: " + e.getMessage());
        }
    }
    
    /**
     * 根据用户ID查询消息列表
     */
    @GetMapping("/user/{userId}")
    public Result<MessageListResponse> getMessagesByUserId(@PathVariable Long userId) {
        try {
            List<DingTalkSendMessage> messages = dingTalkSendMessageService.findByUserId(userId);
            
            MessageListResponse response = new MessageListResponse();
            response.setMessages(messages);
            response.setTotalCount(messages.size());
            response.setCurrentPage(1);
            response.setPageSize(messages.size());
            
            return Result.success(response);
        } catch (Exception e) {
            return Result.error("查询消息失败: " + e.getMessage());
        }
    }
    
    /**
     * 根据应用ID和用户ID查询消息列表
     */
    @GetMapping("/agent/{agentId}/user/{userId}")
    public Result<MessageListResponse> getMessagesByAgentIdAndUserId(
            @PathVariable String agentId, @PathVariable Long userId) {
        try {
            List<DingTalkSendMessage> messages = dingTalkSendMessageService.findByAgentIdAndUserId(agentId, userId);
            
            MessageListResponse response = new MessageListResponse();
            response.setMessages(messages);
            response.setTotalCount(messages.size());
            response.setCurrentPage(1);
            response.setPageSize(messages.size());
            
            return Result.success(response);
        } catch (Exception e) {
            return Result.error("查询消息失败: " + e.getMessage());
        }
    }
    
    /**
     * 根据消息key查询消息
     */
    @GetMapping("/key/{msgKey}")
    public Result<DingTalkSendMessage> getMessageByMsgKey(@PathVariable String msgKey) {
        try {
            DingTalkSendMessage message = dingTalkSendMessageService.findByMsgKey(msgKey);
            if (message != null) {
                return Result.success(message);
            } else {
                return Result.error("消息不存在");
            }
        } catch (Exception e) {
            return Result.error("查询消息失败: " + e.getMessage());
        }
    }
    
    /**
     * 查询所有消息
     */
    @GetMapping("/all")
    public Result<MessageListResponse> getAllMessages() {
        try {
            List<DingTalkSendMessage> messages = dingTalkSendMessageService.findAll();
            
            MessageListResponse response = new MessageListResponse();
            response.setMessages(messages);
            response.setTotalCount(messages.size());
            response.setCurrentPage(1);
            response.setPageSize(messages.size());
            
            return Result.success(response);
        } catch (Exception e) {
            return Result.error("查询消息失败: " + e.getMessage());
        }
    }
    
    /**
     * 更新消息
     */
    @PutMapping("/update")
    public Result<DingTalkSendMessage> updateMessage(@RequestBody DingTalkSendMessage message) {
        try {
            DingTalkSendMessage updatedMessage = dingTalkSendMessageService.update(message);
            return Result.success("消息更新成功", updatedMessage);
        } catch (Exception e) {
            return Result.error("更新消息失败: " + e.getMessage());
        }
    }
    
    /**
     * 根据ID删除消息
     */
    @DeleteMapping("/{id}")
    public Result<DeleteResponse> deleteMessageById(@PathVariable Long id) {
        try {
            boolean result = dingTalkSendMessageService.deleteById(id);
            if (result) {
                DeleteResponse response = new DeleteResponse();
                response.setSuccess(true);
                response.setDeletedCount(1);
                response.setMessage("消息删除成功");
                return Result.success(response);
            } else {
                return Result.error("消息删除失败或消息不存在");
            }
        } catch (Exception e) {
            return Result.error("删除消息失败: " + e.getMessage());
        }
    }
    
    /**
     * 根据用户ID删除消息
     */
    @DeleteMapping("/user/{userId}")
    public Result<DeleteResponse> deleteMessagesByUserId(@PathVariable Long userId) {
        try {
            int count = dingTalkSendMessageService.deleteByUserId(userId);
            
            DeleteResponse response = new DeleteResponse();
            response.setSuccess(true);
            response.setDeletedCount(count);
            response.setMessage("删除成功，共删除 " + count + " 条消息");
            
            return Result.success(response);
        } catch (Exception e) {
            return Result.error("删除消息失败: " + e.getMessage());
        }
    }
} 