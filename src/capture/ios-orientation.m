// Read the foreground interface orientation without launching or activating an app.
// FrontBoardServices is private: unavailable selectors/unknown states must fail closed.
#import <Foundation/Foundation.h>
#import <UIKit/UIOrientation.h>
#import <objc/message.h>
#import <dlfcn.h>

int main(void) {
  @autoreleasepool {
    @try {
      if (!dlopen("/System/Library/PrivateFrameworks/FrontBoardServices.framework/FrontBoardServices", RTLD_NOW)) return 2;
      Class cls = NSClassFromString(@"FBSOrientationObserver");
      id observer = [[cls alloc] init];
      SEL read = NSSelectorFromString(@"activeInterfaceOrientation");
      SEL invalidate = NSSelectorFromString(@"invalidate");
      if (!observer || ![observer respondsToSelector:read] || ![observer respondsToSelector:invalidate]) return 3;
      long long value = ((long long (*)(id, SEL))objc_msgSend)(observer, read);
      ((void (*)(id, SEL))objc_msgSend)(observer, invalidate);
      const char *orientation = NULL;
      switch (value) {
        case UIInterfaceOrientationPortrait: orientation = "portrait"; break;
        case UIInterfaceOrientationPortraitUpsideDown: orientation = "portrait-upside-down"; break;
        case UIInterfaceOrientationLandscapeLeft: orientation = "landscape-left"; break;
        case UIInterfaceOrientationLandscapeRight: orientation = "landscape-right"; break;
        default: return 4;
      }
      printf("{\"version\":1,\"orientation\":\"%s\"}\n", orientation);
      return 0;
    } @catch (NSException *exception) {
      return 5;
    }
  }
}
