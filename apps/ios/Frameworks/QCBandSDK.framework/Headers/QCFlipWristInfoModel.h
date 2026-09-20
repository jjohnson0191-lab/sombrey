//
//  QCFlipWristInfoModel.h
//  QCBandSDK
//
//  Created by steve on 2025/3/31.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface QCFlipWristInfoModel : NSObject

@property (nonatomic,assign) BOOL enable;
@property (nonatomic,assign) NSInteger flipType; //佩戴方式，左右手,1:Left,2:Right
@property (nonatomic,assign) NSInteger brightness; //亮度调节
@property (nonatomic,assign) NSInteger brightnessMax; //最大亮度调节
@property (nonatomic,assign) NSInteger timeMode; //1.自定义，2.关闭
@property (nonatomic,assign) NSInteger startTime; //亮屏开始时间
@property (nonatomic,assign) NSInteger endTime;//亮屏结束时间
@end

NS_ASSUME_NONNULL_END
