//
//  QCHRVModel.h
//  QCBandSDK
//
//  Created by steve on 2024/8/7.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface QCHRVModel : NSObject

@property (nonatomic, strong) NSString *date;                  // 日期, 格式为"yyyy-MM-dd"
@property (nonatomic, strong) NSArray<NSNumber *> *hrv;        // 心率数组, 每N分钟1条
@property (nonatomic, assign) NSInteger secondInterval;        // 数据时间间隔, 单位为秒
@end

NS_ASSUME_NONNULL_END
