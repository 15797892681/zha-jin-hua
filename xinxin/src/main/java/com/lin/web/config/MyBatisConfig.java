package com.lin.web.config;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.context.annotation.Configuration;

/**
 * MyBatis配置类
 */
@Configuration
@MapperScan("com.lin.web.mapper")
public class MyBatisConfig {
    
    // MyBatis配置可以在这里添加
    // 例如：分页插件、类型处理器等
    
} 