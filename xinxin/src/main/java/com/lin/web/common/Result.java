package com.lin.web.common;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 通用响应结果类
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class Result<T> {
    
    /**
     * 是否成功
     */
    private boolean success;
    
    /**
     * 响应消息
     */
    private String message;
    
    /**
     * 响应数据
     */
    private T data;
    
    /**
     * 响应代码
     */
    private Integer code;
    
    /**
     * 带参数的构造函数
     */
    public Result(boolean success, String message) {
        this.success = success;
        this.message = message;
    }
    
    public Result(boolean success, String message, T data) {
        this.success = success;
        this.message = message;
        this.data = data;
    }
    
    // 静态方法
    public static <T> Result<T> success() {
        return new Result<>(true, "操作成功", null, 200);
    }
    
    public static <T> Result<T> success(String message) {
        return new Result<>(true, message, null, 200);
    }
    
    public static <T> Result<T> success(T data) {
        return new Result<>(true, "操作成功", data, 200);
    }
    
    public static <T> Result<T> success(String message, T data) {
        return new Result<>(true, message, data, 200);
    }
    
    public static <T> Result<T> error() {
        return new Result<>(false, "操作失败", null, 500);
    }
    
    public static <T> Result<T> error(String message) {
        return new Result<>(false, message, null, 500);
    }
    
    public static <T> Result<T> error(String message, Integer code) {
        return new Result<>(false, message, null, code);
    }
    
    public static <T> Result<T> error(String message, T data) {
        return new Result<>(false, message, data, 500);
    }
} 