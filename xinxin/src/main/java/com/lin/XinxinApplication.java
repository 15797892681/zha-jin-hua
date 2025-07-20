package com.lin;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
@MapperScan("com.lin.web.mapper")
public class XinxinApplication {

    public static void main(String[] args) {
        SpringApplication.run(XinxinApplication.class, args);
    }

}
