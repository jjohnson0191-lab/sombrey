//
//  QCSedentaryModel.h
//  QCBandSDK
//
//  Created by steve on 2024/9/3.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface QCSedentaryModel : NSObject

@property (nonatomic, strong) NSString *date; //发生时间 yyyy-MM-dd HH:mm:ss
@property (nonatomic, strong) NSString *endTime; //结束时间. yyyy-MM-dd HH:mm:ss
@property (nonatomic, assign) NSInteger type; //0 静态(1分钟内小于 30步)，1触发久坐，2运动(大于 30步)
@property (nonatomic, assign) NSInteger duration; //单位：分钟
@end

NS_ASSUME_NONNULL_END
