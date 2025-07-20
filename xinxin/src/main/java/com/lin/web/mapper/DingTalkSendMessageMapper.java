package com.lin.web.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.lin.web.entity.DingTalkSendMessage;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

/**
 * 钉钉发送消息Mapper接口
 */
@Mapper
public interface DingTalkSendMessageMapper extends BaseMapper<DingTalkSendMessage> {
    
    /**
     * 根据ID查询消息
     * @param id 消息ID
     * @return 消息对象
     */
    DingTalkSendMessage selectById(@Param("id") Long id);
    
    /**
     * 根据用户ID查询消息列表
     * @param userId 用户ID
     * @return 消息列表
     */
    List<DingTalkSendMessage> selectByUserId(@Param("userId") Long userId);
    
    /**
     * 根据应用ID和用户ID查询消息列表
     * @param agentId 应用ID
     * @param userId 用户ID
     * @return 消息列表
     */
    List<DingTalkSendMessage> selectByAgentIdAndUserId(@Param("agentId") String agentId, @Param("userId") Long userId);
    
    /**
     * 根据消息key查询消息
     * @param msgKey 消息key
     * @return 消息对象
     */
    DingTalkSendMessage selectByMsgKey(@Param("msgKey") String msgKey);
    
    /**
     * 查询所有消息
     * @return 消息列表
     */
    List<DingTalkSendMessage> selectAll();
    
    /**
     * 更新消息
     * @param message 消息对象
     * @return 影响行数
     */
    int update(DingTalkSendMessage message);
    
    /**
     * 根据ID删除消息
     * @param id 消息ID
     * @return 影响行数
     */
    int deleteById(@Param("id") Long id);
    
    /**
     * 根据用户ID删除消息
     * @param userId 用户ID
     * @return 影响行数
     */
    int deleteByUserId(@Param("userId") Long userId);
} 